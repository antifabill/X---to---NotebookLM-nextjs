"use client";

import type { DriveAccount, DriveClientState, JobResult } from "@/lib/types";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const TOKEN_STORAGE_KEY = "x-to-notebooklm.drive.token";
const ACCOUNT_STORAGE_KEY = "x-to-notebooklm.drive.account";
const DRIVE_ROOT_FOLDER = "X to NotebookLM Exports";

type StoredToken = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

type DriveUploadResult = {
  folderId: string;
  folderUrl: string;
  uploadedCount: number;
};

function configured() {
  return Boolean(GOOGLE_CLIENT_ID);
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearStoredSession() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
}

function readStoredToken() {
  const token = readJson<StoredToken>(TOKEN_STORAGE_KEY);
  if (!token?.accessToken) return null;
  return token;
}

function readStoredAccount() {
  return readJson<DriveAccount>(ACCOUNT_STORAGE_KEY);
}

function validStoredToken() {
  const token = readStoredToken();
  if (!token) return null;
  return token.expiresAt > Date.now() + 60_000 ? token : null;
}

async function loadGoogleIdentityScript() {
  if (typeof window === "undefined") throw new Error("Google Drive auth is only available in the browser.");
  if (window.google?.accounts?.oauth2) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google Identity Services.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  });
}

async function fetchGoogleAccount(accessToken: string): Promise<DriveAccount> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Connected to Google, but could not read the account profile.");
  const payload = (await response.json()) as { email?: string; name?: string; picture?: string };
  if (!payload.email) throw new Error("Google did not return an account email.");
  const account = {
    email: payload.email,
    name: payload.name || null,
    picture: payload.picture || null,
  };
  writeJson(ACCOUNT_STORAGE_KEY, account);
  return account;
}

function tokenStateMessage(account?: DriveAccount | null) {
  if (account?.email) return `Connected as ${account.email}`;
  return "Connected to Google Drive.";
}

export async function getDriveClientState(): Promise<DriveClientState> {
  if (!configured()) {
    return {
      status: "unavailable",
      message: "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive sign-in in the browser.",
    };
  }

  const token = validStoredToken();
  const account = readStoredAccount();
  if (!token) {
    return {
      status: "disconnected",
      message: account?.email
        ? `Ready to reconnect ${account.email} when you upload again.`
        : "Connect Google Drive to upload finished batches from the browser.",
      account,
    };
  }

  return {
    status: "connected",
    message: tokenStateMessage(account),
    account,
  };
}

async function requestDriveToken(prompt: string) {
  if (!configured()) throw new Error("Google Drive auth is not configured yet.");
  await loadGoogleIdentityScript();

  return new Promise<StoredToken>((resolve, reject) => {
    const tokenClient = window.google?.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      prompt,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || "Google Drive sign-in was cancelled."));
          return;
        }

        const token = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in || 3600) * 1000,
          scope: response.scope || DRIVE_SCOPE,
        };
        writeJson(TOKEN_STORAGE_KEY, token);
        resolve(token);
      },
      error_callback: () => reject(new Error("Google Drive sign-in did not complete.")),
    });

    if (!tokenClient) {
      reject(new Error("Could not initialize the Google token client."));
      return;
    }

    tokenClient.requestAccessToken({ prompt });
  });
}

export async function connectGoogleDrive(interactive = true): Promise<DriveClientState> {
  if (!configured()) return getDriveClientState();

  let token = validStoredToken();
  if (!token) {
    try {
      token = await requestDriveToken(interactive ? "consent" : "");
    } catch (error) {
      if (!interactive) {
        token = await requestDriveToken("consent");
      } else {
        throw error;
      }
    }
  }

  const account = await fetchGoogleAccount(token.accessToken);
  return {
    status: "connected",
    message: tokenStateMessage(account),
    account,
  };
}

export async function disconnectGoogleDrive() {
  const token = readStoredToken();
  await loadGoogleIdentityScript().catch(() => undefined);
  if (token?.accessToken && window.google?.accounts.oauth2) {
    await new Promise<void>((resolve) => {
      window.google?.accounts.oauth2.revoke(token.accessToken, () => resolve());
    });
  }
  clearStoredSession();
  return {
    status: configured() ? "disconnected" : "unavailable",
    message: configured()
      ? "Disconnected from Google Drive."
      : "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive sign-in in the browser.",
  } satisfies DriveClientState;
}

async function driveFetchJson<T>(accessToken: string, url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

async function ensureDriveFolder(accessToken: string, name: string, parentId?: string) {
  const clauses = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `name='${name.replaceAll("'", "\\'")}'`,
  ];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id,name)&pageSize=1`;
  const existing = await driveFetchJson<{ files?: Array<{ id: string; name: string }> }>(accessToken, searchUrl);
  if (existing.files?.[0]?.id) return existing.files[0].id;

  const created = await driveFetchJson<{ id: string }>(accessToken, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return created.id;
}

function contentTypeForFile(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function uploadDriveFile(accessToken: string, parentId: string, fileName: string, blob: Blob) {
  const boundary = `xToNotebookLm${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentId],
  });
  const mimeType = contentTypeForFile(fileName);
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  return driveFetchJson<{ id: string }>(
    accessToken,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
}

function collectJobFiles(job: JobResult) {
  const files = new Set<string>([job.manifestFile, job.guideFile, job.bundleFile]);
  for (const record of job.records) {
    for (const file of record.outputFiles) files.add(file);
    for (const file of record.mediaFiles) files.add(file);
  }
  return [...files];
}

async function fetchJobFile(baseUrl: string, jobId: string, relativeFile: string) {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/download?file=${encodeURIComponent(relativeFile)}`);
  if (!response.ok) throw new Error(`Could not download ${relativeFile} from the app server.`);
  return response.blob();
}

export async function uploadJobToDrive(
  job: JobResult,
  options?: {
    baseUrl?: string;
    onProgress?: (current: number, total: number, fileName: string) => void;
  },
): Promise<DriveUploadResult> {
  const driveState = await connectGoogleDrive(false);
  if (driveState.status !== "connected") throw new Error("Google Drive is not connected.");

  const token = validStoredToken();
  if (!token) throw new Error("Google Drive access expired. Please reconnect and try again.");

  const baseUrl = options?.baseUrl || window.location.origin;
  const rootFolderId = await ensureDriveFolder(token.accessToken, DRIVE_ROOT_FOLDER);
  const batchFolderId = await ensureDriveFolder(token.accessToken, `${job.outDirName}-${job.jobId.slice(-8)}`, rootFolderId);
  const folderCache = new Map<string, string>([["", batchFolderId]]);
  const files = collectJobFiles(job);

  for (const [index, relativeFile] of files.entries()) {
    const parts = relativeFile.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;

    let parentId = batchFolderId;
    let currentPath = "";
    for (const segment of parts) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const cachedFolder = folderCache.get(currentPath);
      if (cachedFolder) {
        parentId = cachedFolder;
        continue;
      }

      const createdFolderId = await ensureDriveFolder(token.accessToken, segment, parentId);
      folderCache.set(currentPath, createdFolderId);
      parentId = createdFolderId;
    }

    options?.onProgress?.(index + 1, files.length, relativeFile);
    const blob = await fetchJobFile(baseUrl, job.jobId, relativeFile);
    await uploadDriveFile(token.accessToken, parentId, fileName, blob);
  }

  return {
    folderId: batchFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${batchFolderId}`,
    uploadedCount: files.length,
  };
}

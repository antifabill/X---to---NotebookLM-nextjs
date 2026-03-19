"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getDriveClientState,
  uploadJobToDrive,
} from "@/lib/google-drive";
import type { DriveClientState, JobResult, PreviewPayload } from "@/lib/notebooklm";

type AppShellProps = {
  initialRecentJobs: JobResult[];
};

const SAMPLE_URL = "https://x.com/itsolelehmann/status/2033919415771713715?s=20";
const NOTEBOOKLM_URL = "https://notebooklm.google.com/";

export function AppShell({ initialRecentJobs }: AppShellProps) {
  const [urls, setUrls] = useState("");
  const [folderName, setFolderName] = useState("");
  const [includeMedia, setIncludeMedia] = useState(true);
  const [openNotebookLm, setOpenNotebookLm] = useState(false);
  const [fmtTxt, setFmtTxt] = useState(true);
  const [fmtMd, setFmtMd] = useState(true);
  const [fmtPdf, setFmtPdf] = useState(true);
  const [fmtHtml, setFmtHtml] = useState(true);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewStatus, setPreviewStatus] = useState("Waiting for a URL");
  const [result, setResult] = useState<JobResult | null>(null);
  const [recentJobs, setRecentJobs] = useState(initialRecentJobs);
  const [error, setError] = useState<string | null>(null);
  const [drive, setDrive] = useState<DriveClientState>({
    status: "connecting",
    message: "Checking Google Drive connection...",
  });
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveUploadMessage, setDriveUploadMessage] = useState<string | null>(null);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getDriveClientState()
      .then((state) => {
        if (!cancelled) setDrive(state);
      })
      .catch(() => {
        if (!cancelled) {
          setDrive({
            status: "disconnected",
            message: "Google Drive could not be initialized in this browser yet.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const firstUrl = urls
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!firstUrl) {
      setPreview(null);
      setPreviewStatus("Waiting for a URL");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setPreviewStatus("Loading preview...");
        const response = await fetch(`/api/preview?url=${encodeURIComponent(firstUrl)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as PreviewPayload;
        setPreview(payload);
        setPreviewStatus(payload.ok ? "Preview ready" : "Preview unavailable");
      } catch {
        if (!controller.signal.aborted) {
          setPreview({ ok: false, error: "Could not load the preview right now.", url: firstUrl });
          setPreviewStatus("Preview failed");
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [urls]);

  const lineCount = urls
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;

  function mergeText(text: string, replace = false) {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) return;
    setUrls((current) => (replace || !current.trim() ? normalized : `${current.trimEnd()}\n${normalized}`));
  }

  async function pasteFromClipboard() {
    try {
      mergeText(await navigator.clipboard.readText());
    } catch {
      setError("Clipboard paste is blocked in this browser. Paste directly into the box instead.");
    }
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name))) {
      mergeText(await file.text());
      return;
    }
    const uriList = event.dataTransfer.getData("text/uri-list");
    const plainText = event.dataTransfer.getData("text/plain");
    mergeText(uriList || plainText);
  }

  async function refreshRecentJobs() {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const jobs = (await response.json()) as JobResult[];
    setRecentJobs(jobs);
  }

  function exportFormats() {
    const formats = [];
    if (fmtTxt) formats.push("txt");
    if (fmtMd) formats.push("md");
    if (fmtPdf) formats.push("pdf");
    if (fmtHtml) formats.push("html");
    return formats;
  }

  async function handleDriveConnect() {
    setError(null);
    setDriveBusy(true);
    setDriveUploadMessage(null);
    try {
      setDrive(await connectGoogleDrive(true));
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect Google Drive.");
    } finally {
      setDriveBusy(false);
    }
  }

  async function handleDriveDisconnect() {
    setDriveBusy(true);
    setDriveUploadMessage(null);
    try {
      setDrive(await disconnectGoogleDrive());
      setDriveFolderUrl(null);
    } finally {
      setDriveBusy(false);
    }
  }

  async function handleDriveUpload(job: JobResult) {
    setError(null);
    setDriveBusy(true);
    setDriveUploadMessage("Connecting to Google Drive...");
    try {
      const state = await connectGoogleDrive(false);
      setDrive(state);
      const upload = await uploadJobToDrive(job, {
        baseUrl: window.location.origin,
        onProgress: (current, total, fileName) =>
          setDriveUploadMessage(`Uploading ${current}/${total}: ${fileName}`),
      });
      setDriveFolderUrl(upload.folderUrl);
      setDriveUploadMessage(`Uploaded ${upload.uploadedCount} files to Google Drive.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the batch to Google Drive.");
    } finally {
      setDriveBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const parsedUrls = urls
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const response = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urls: parsedUrls,
            folderName,
            exportFormats: exportFormats(),
            includeMedia,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Could not process the batch.");
        }
        setResult(payload as JobResult);
        await refreshRecentJobs();
        if (openNotebookLm) {
          window.open(NOTEBOOKLM_URL, "_blank", "noopener,noreferrer");
        }
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unknown processing error");
      }
    });
  }

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">Next.js Fork In Progress</div>
          <h1 className="title">X to NotebookLM</h1>
          <p className="subtitle">
            This fork is the Next.js migration of the original Python tool. It already supports
            preview, extraction, Markdown/TXT/PDF export, media download, and zip bundles through
            Next.js route handlers.
          </p>
          <div className="miniGrid">
            <article className="miniCard">
              <strong>1. Paste URLs</strong>
              <span>Tweet URLs still work best, especially when the tweet contains an attached X Article.</span>
            </article>
            <article className="miniCard">
              <strong>2. Preview first</strong>
              <span>The first source is previewed live so we can spot bad input before export.</span>
            </article>
            <article className="miniCard">
              <strong>3. Export bundle</strong>
              <span>Generate NotebookLM-ready files and download the batch from the browser.</span>
            </article>
          </div>
        </div>
        <div className="heroCard">
          <div className="pill">Migration note</div>
          <p>
            Google Drive is now set up as a browser-based auth and upload flow. Once connected, the
            app can push a generated batch directly into a Drive folder without a local
            `credentials.json` step for the end user.
          </p>
        </div>
      </section>

      <form className="mainCard" onSubmit={handleSubmit}>
        <div className="mainGrid">
          <div className="dropZone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <div className="dropHeader">
              <label htmlFor="urls">X URLs, one per line</label>
              <div className="toolRow">
                <button className="ghostButton" type="button" onClick={pasteFromClipboard}>
                  Paste clipboard
                </button>
                <button className="ghostButton" type="button" onClick={() => mergeText(SAMPLE_URL, true)}>
                  Load sample
                </button>
                <button className="secondaryButton" type="button" onClick={() => setUrls("")}>
                  Clear
                </button>
              </div>
            </div>
            <textarea
              id="urls"
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder={`${SAMPLE_URL}\nhttps://x.com/jack/status/20`}
            />
            <div className="helperText">Drag URLs, copied text, or a `.txt` file into this box.</div>
            <div className="helperText">{lineCount} URL{lineCount === 1 ? "" : "s"} ready</div>
          </div>

          <div className="sidebar">
            <article className="previewCard">
              <div className="previewLabel">Preview</div>
              <div className="statusRow">{previewStatus}</div>
              <h3 className="previewTitle">{preview?.title || "No preview yet"}</h3>
              <div className="previewMeta">
                {preview?.ok
                  ? [preview.kind, preview.author, preview.published, `${preview.mediaCount || 0} images`]
                      .filter(Boolean)
                      .join(" • ")
                  : "Paste or drag in a URL and the app will preview the first source here."}
              </div>
              <p className="previewText">
                {preview?.ok
                  ? preview.excerpt
                  : preview?.error ||
                    "The preview card shows the title, type, metadata, and excerpt before export."}
              </p>
              {preview?.note ? <div className="helperText">{preview.note}</div> : null}
            </article>

            <div className="stackCard">
              <label htmlFor="folderName">Batch name</label>
              <input
                id="folderName"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="optional-batch-name"
              />
            </div>

            <div className="stackCard">
              <span className="sectionLabel">Formats</span>
              <label><input type="checkbox" checked={fmtTxt} onChange={(e) => setFmtTxt(e.target.checked)} /> TXT</label>
              <label><input type="checkbox" checked={fmtMd} onChange={(e) => setFmtMd(e.target.checked)} /> Markdown</label>
              <label><input type="checkbox" checked={fmtPdf} onChange={(e) => setFmtPdf(e.target.checked)} /> PDF</label>
              <label><input type="checkbox" checked={fmtHtml} onChange={(e) => setFmtHtml(e.target.checked)} /> HTML snapshot</label>
            </div>

            <div className="stackCard">
              <span className="sectionLabel">Extras</span>
              <label><input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} /> Download images</label>
              <label><input type="checkbox" checked={openNotebookLm} onChange={(e) => setOpenNotebookLm(e.target.checked)} /> Open NotebookLM after export</label>
            </div>

            <div className="stackCard">
              <span className="sectionLabel">Google Drive</span>
              <p className="helperText">{drive.message}</p>
              {drive.account?.email ? <div className="helperText">{drive.account.email}</div> : null}
              {driveUploadMessage ? <div className="helperText">{driveUploadMessage}</div> : null}
              {driveFolderUrl ? (
                <a className="badge" href={driveFolderUrl} target="_blank" rel="noreferrer">
                  Open uploaded folder
                </a>
              ) : null}
              <div className="toolRow">
                <button
                  className="ghostButton"
                  type="button"
                  onClick={handleDriveConnect}
                  disabled={driveBusy || drive.status === "unavailable"}
                >
                  {drive.status === "connected" ? "Reconnect" : "Connect Google Drive"}
                </button>
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={handleDriveDisconnect}
                  disabled={driveBusy || drive.status !== "connected"}
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="actionRow">
          <button className="primaryButton" disabled={isPending} type="submit">
            {isPending ? "Converting..." : "Convert sources"}
          </button>
          <a className="secondaryButton linkButton" href={NOTEBOOKLM_URL} target="_blank" rel="noreferrer">
            Open NotebookLM
          </a>
        </div>
        {error ? <div className="errorBox">{error}</div> : null}
      </form>

      {result ? (
        <section className="panel">
          <div className="pill ok">Latest batch</div>
          <div className="stats">
            <div className="stat"><strong>{result.records.length}</strong><span>Sources converted</span></div>
            <div className="stat"><strong>{result.failures.length}</strong><span>Failed URLs</span></div>
            <div className="stat"><strong>{result.outDirName}</strong><span>Server job folder</span></div>
          </div>
          <div className="fileList">
            {result.records.map((record) => (
              <article className="fileCard" key={`${result.jobId}-${record.url}`}>
                <div>
                  <strong>{record.title}</strong>
                  <div className="helperText">{record.url}</div>
                  {record.note ? <div className="helperText">{record.note}</div> : null}
                </div>
                <div className="badgeRow">
                  {record.outputFiles.map((file) => (
                    <a className="badge" href={`/api/jobs/${result.jobId}/download?file=${encodeURIComponent(file)}`} key={file}>
                      {file.split(".").pop()?.toUpperCase()}
                    </a>
                  ))}
                  {record.mediaFiles.map((file) => (
                    <a className="badge" href={`/api/jobs/${result.jobId}/download?file=${encodeURIComponent(file)}`} key={file}>
                      IMG
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="actionRow">
            <a className="secondaryButton linkButton" href={`/api/jobs/${result.jobId}/bundle`}>
              Download zip
            </a>
            <a className="secondaryButton linkButton" href={`/api/jobs/${result.jobId}/download?file=${encodeURIComponent(result.guideFile)}`}>
              Import guide
            </a>
            <button
              className="secondaryButton"
              type="button"
              onClick={() => void handleDriveUpload(result)}
              disabled={driveBusy || drive.status === "unavailable"}
            >
              {driveBusy ? "Working..." : "Upload batch to Drive"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="pill">Recent jobs</div>
        <div className="fileList">
          {recentJobs.length ? (
            recentJobs.map((job) => (
              <article className="fileCard" key={job.jobId}>
                <div>
                  <strong>{job.outDirName}</strong>
                  <div className="helperText">{new Date(job.createdAt).toLocaleString()}</div>
                </div>
                <div className="badgeRow">
                  <a className="badge" href={`/api/jobs/${job.jobId}/bundle`}>ZIP</a>
                  <a className="badge" href={`/api/jobs/${job.jobId}/download?file=${encodeURIComponent(job.guideFile)}`}>GUIDE</a>
                  <button
                    className="badge"
                    type="button"
                    onClick={() => void handleDriveUpload(job)}
                    disabled={driveBusy || drive.status === "unavailable"}
                  >
                    DRIVE
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="helperText">No jobs yet in this Next.js fork.</div>
          )}
        </div>
      </section>
    </div>
  );
}

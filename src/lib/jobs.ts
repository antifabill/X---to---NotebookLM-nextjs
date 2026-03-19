import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import { Storage } from "@google-cloud/storage";

import { buildBatchGuide, buildManifest, buildZip, writeSourceOutputs } from "@/lib/exporter";
import { slugify } from "@/lib/text";
import type { BatchInput, JobResult, SourceRecord } from "@/lib/types";
import { parseSource } from "@/lib/x";

type ResolvedJobFile = {
  name: string;
  bytes: Buffer;
};

const cloudStorageClient = new Storage();

function storageBucketName() {
  return process.env.APP_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || process.env.GCS_STORAGE_BUCKET || "";
}

function cloudStorageEnabled() {
  return Boolean(storageBucketName());
}

function storageBucket() {
  const bucketName = storageBucketName();
  if (!bucketName) throw new Error("Cloud storage is not configured.");
  return cloudStorageClient.bucket(bucketName);
}

function jobsRoot() {
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_SERVICE || process.env.APPHOSTING_ENVIRONMENT_ID) {
    return path.join(os.tmpdir(), "x-to-notebooklm-jobs");
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "jobs");
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function jobDir(jobId: string) {
  return path.join(jobsRoot(), jobId);
}

function outputDirForJob(jobId: string, outDirName: string) {
  return path.join(jobDir(jobId), outDirName);
}

function localJobFilePath(jobId: string) {
  return path.join(jobDir(jobId), "job.json");
}

function cloudJobPrefix(jobId: string) {
  return `jobs/${jobId}`;
}

function cloudOutputPrefix(jobId: string, outDirName: string) {
  return `${cloudJobPrefix(jobId)}/${outDirName}`;
}

function cloudJobFilePath(jobId: string) {
  return `${cloudJobPrefix(jobId)}/job.json`;
}

function normalizeRequestedFile(requestedFile: string) {
  const normalized = path.posix.normalize(requestedFile.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

async function uploadDirectoryToBucket(localDir: string, prefix: string) {
  const bucket = storageBucket();
  const entries = await readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(localDir, entry.name);
    const target = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadDirectoryToBucket(fullPath, target);
      continue;
    }
    await bucket.file(target).save(await readFile(fullPath));
  }
}

async function saveCloudJob(job: JobResult, localOutDir: string) {
  await uploadDirectoryToBucket(localOutDir, cloudOutputPrefix(job.jobId, job.outDirName));
  await storageBucket().file(cloudJobFilePath(job.jobId)).save(Buffer.from(JSON.stringify(job, null, 2), "utf8"), {
    contentType: "application/json; charset=utf-8",
  });
}

async function readCloudJob(jobId: string): Promise<JobResult | null> {
  try {
    const [bytes] = await storageBucket().file(cloudJobFilePath(jobId)).download();
    return JSON.parse(bytes.toString("utf8")) as JobResult;
  } catch {
    return null;
  }
}

async function listCloudJobs(limit: number) {
  const [files] = await storageBucket().getFiles({ prefix: "jobs/" });
  const jobFiles = files.filter((file) => file.name.endsWith("/job.json"));
  const jobs: JobResult[] = [];
  for (const file of jobFiles) {
    try {
      const [bytes] = await file.download();
      jobs.push(JSON.parse(bytes.toString("utf8")) as JobResult);
    } catch {}
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function resolveCloudJobFile(jobId: string, outDirName: string, requestedFile: string): Promise<ResolvedJobFile | null> {
  const normalized = normalizeRequestedFile(requestedFile);
  if (!normalized) return null;
  const file = storageBucket().file(`${cloudOutputPrefix(jobId, outDirName)}/${normalized}`);
  try {
    const [exists] = await file.exists();
    if (!exists) return null;
    const [bytes] = await file.download();
    return {
      name: path.posix.basename(normalized),
      bytes,
    };
  } catch {
    return null;
  }
}

async function deleteCloudJob(jobId: string) {
  await storageBucket().deleteFiles({ prefix: `${cloudJobPrefix(jobId)}/`, force: true });
}

async function readLocalJob(jobId: string): Promise<JobResult | null> {
  try {
    const json = await readFile(localJobFilePath(jobId), "utf8");
    return JSON.parse(json) as JobResult;
  } catch {
    return null;
  }
}

async function listLocalJobs(limit: number) {
  await ensureDir(jobsRoot());
  const entries = await readdir(jobsRoot(), { withFileTypes: true });
  const jobs: JobResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await readLocalJob(entry.name);
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function resolveLocalJobFile(jobId: string, outDirName: string, requestedFile: string): Promise<ResolvedJobFile | null> {
  const normalized = normalizeRequestedFile(requestedFile);
  if (!normalized) return null;
  const root = path.normalize(outputDirForJob(jobId, outDirName));
  const target = path.normalize(path.join(root, normalized));
  if (!target.startsWith(root)) return null;
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile()) return null;
    return {
      name: path.basename(target),
      bytes: await readFile(target),
    };
  } catch {
    return null;
  }
}

async function saveLocalJob(job: JobResult) {
  await ensureDir(jobDir(job.jobId));
  await writeFile(localJobFilePath(job.jobId), JSON.stringify(job, null, 2), "utf8");
}

async function createWorkspace(jobId: string, outDirName: string) {
  if (!cloudStorageEnabled()) {
    const outDir = outputDirForJob(jobId, outDirName);
    await ensureDir(outDir);
    return {
      outDir,
      cleanup: async () => undefined,
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "x-to-notebooklm-"));
  const outDir = path.join(tempRoot, outDirName);
  await ensureDir(outDir);
  return {
    outDir,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function runBatch(input: BatchInput): Promise<JobResult> {
  const jobId = `job-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const createdAt = Date.now();
  const outDirName = slugify(
    input.folderName || `batch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
    120,
  );
  const workspace = await createWorkspace(jobId, outDirName);

  try {
    const records: SourceRecord[] = [];
    const failures: Array<[string, string]> = [];
    const formats = new Set(input.exportFormats.length ? input.exportFormats : ["txt"]);

    for (const url of input.urls) {
      try {
        const source = await parseSource(url);
        records.push(await writeSourceOutputs(source, workspace.outDir, formats, input.includeMedia));
      } catch (error) {
        failures.push([url, error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error"]);
      }
    }

    const manifestFile = await buildManifest(records, workspace.outDir);
    const guideFile = await buildBatchGuide(records, failures, workspace.outDir);
    const bundleFile = await buildZip(workspace.outDir);

    const result: JobResult = {
      jobId,
      createdAt,
      status: "done",
      outDirName,
      records,
      failures,
      manifestFile,
      guideFile,
      bundleFile,
    };

    if (cloudStorageEnabled()) {
      await saveCloudJob(result, workspace.outDir);
    } else {
      await saveLocalJob(result);
    }

    return result;
  } finally {
    if (cloudStorageEnabled()) {
      await workspace.cleanup();
    }
  }
}

export async function getJob(jobId: string): Promise<JobResult | null> {
  if (cloudStorageEnabled()) return readCloudJob(jobId);
  return readLocalJob(jobId);
}

export async function listRecentJobs(limit = 6): Promise<JobResult[]> {
  if (cloudStorageEnabled()) return listCloudJobs(limit);
  return listLocalJobs(limit);
}

export async function resolveJobFile(jobId: string, requestedFile: string): Promise<ResolvedJobFile | null> {
  const job = await getJob(jobId);
  if (!job) return null;
  if (cloudStorageEnabled()) return resolveCloudJobFile(jobId, job.outDirName, requestedFile);
  return resolveLocalJobFile(jobId, job.outDirName, requestedFile);
}

export async function deleteJob(jobId: string) {
  if (cloudStorageEnabled()) {
    await deleteCloudJob(jobId);
    return;
  }
  await rm(jobDir(jobId), { recursive: true, force: true });
}

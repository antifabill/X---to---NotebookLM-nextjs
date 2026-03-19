import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { buildBatchGuide, buildManifest, buildZip, writeSourceOutputs } from "@/lib/exporter";
import { slugify } from "@/lib/text";
import type { BatchInput, DriveState, JobResult, SourceRecord } from "@/lib/types";
import { parseSource } from "@/lib/x";

function jobsRoot() {
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

function jobFilePath(jobId: string) {
  return path.join(jobDir(jobId), "job.json");
}

export async function runBatch(input: BatchInput): Promise<JobResult> {
  const jobId = `job-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const createdAt = Date.now();
  const outDirName = slugify(
    input.folderName || `batch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
    120,
  );
  const outDir = outputDirForJob(jobId, outDirName);
  await ensureDir(outDir);

  const records: SourceRecord[] = [];
  const failures: Array<[string, string]> = [];
  const formats = new Set(input.exportFormats.length ? input.exportFormats : ["txt"]);

  for (const url of input.urls) {
    try {
      const source = await parseSource(url);
      records.push(await writeSourceOutputs(source, outDir, formats, input.includeMedia));
    } catch (error) {
      failures.push([url, error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error"]);
    }
  }

  const manifestFile = await buildManifest(records, outDir);
  const guideFile = await buildBatchGuide(records, failures, outDir);
  const bundleFile = await buildZip(outDir);

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

  await ensureDir(jobDir(jobId));
  await writeFile(jobFilePath(jobId), JSON.stringify(result, null, 2), "utf8");
  return result;
}

export async function getJob(jobId: string): Promise<JobResult | null> {
  try {
    const json = await readFile(jobFilePath(jobId), "utf8");
    return JSON.parse(json) as JobResult;
  } catch {
    return null;
  }
}

export async function listRecentJobs(limit = 6): Promise<JobResult[]> {
  await ensureDir(jobsRoot());
  const entries = await readdir(jobsRoot(), { withFileTypes: true });
  const jobs: JobResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await getJob(entry.name);
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function resolveJobFile(jobId: string, requestedFile: string) {
  const job = await getJob(jobId);
  if (!job) return null;
  const target = path.normalize(path.join(outputDirForJob(jobId, job.outDirName), requestedFile));
  const root = path.normalize(outputDirForJob(jobId, job.outDirName));
  if (!target.startsWith(root)) return null;
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile()) return null;
    return {
      path: target,
      name: path.basename(target),
    };
  } catch {
    return null;
  }
}

export async function deleteJob(jobId: string) {
  await rm(jobDir(jobId), { recursive: true, force: true });
}

export function driveConnectionStatus(): DriveState {
  return {
    connected: false,
    message:
      "Drive auth is not ported in the first Next.js migration slice yet. This fork focuses on preview, extraction, export, and downloadable results first.",
  };
}

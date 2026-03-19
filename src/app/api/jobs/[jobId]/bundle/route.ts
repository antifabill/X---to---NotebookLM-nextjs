import { getJob, resolveJobFile } from "@/lib/notebooklm";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getJob(jobId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }
  const file = await resolveJobFile(jobId, job.bundleFile);
  if (!file) {
    return new Response("Bundle not found", { status: 404 });
  }
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${file.name}"`,
    },
  });
}

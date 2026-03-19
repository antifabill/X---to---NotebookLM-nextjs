import path from "node:path";

import { resolveJobFile } from "@/lib/notebooklm";

export const runtime = "nodejs";

function contentTypeForExtension(ext: string) {
  switch (ext) {
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const requestedFile = new URL(request.url).searchParams.get("file") || "";
  const file = await resolveJobFile(jobId, requestedFile);
  if (!file) {
    return new Response("File not found", { status: 404 });
  }
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": contentTypeForExtension(path.extname(file.name).toLowerCase()),
      "Content-Disposition": `attachment; filename="${file.name}"`,
    },
  });
}

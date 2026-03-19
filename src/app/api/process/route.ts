import { NextResponse } from "next/server";

import { runBatch } from "@/lib/notebooklm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runBatch({
      urls: Array.isArray(body.urls) ? body.urls : [],
      folderName: body.folderName || "",
      exportFormats: Array.isArray(body.exportFormats) ? body.exportFormats : ["txt", "md", "pdf"],
      includeMedia: body.includeMedia !== false,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error" },
      { status: 400 },
    );
  }
}

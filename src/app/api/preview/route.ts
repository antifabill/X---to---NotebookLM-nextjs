import { NextResponse } from "next/server";

import { sourcePreview } from "@/lib/notebooklm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") || "";
  if (!url.trim()) {
    return NextResponse.json({ ok: false, error: "No URL was provided." }, { status: 400 });
  }
  return NextResponse.json(await sourcePreview(url));
}

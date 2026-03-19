import { NextResponse } from "next/server";

import { listRecentJobs } from "@/lib/notebooklm";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listRecentJobs());
}

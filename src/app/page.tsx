import { AppShell } from "@/components/app-shell";
import { listRecentJobs } from "@/lib/notebooklm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const recentJobs = await listRecentJobs();
  return <AppShell initialRecentJobs={recentJobs} />;
}

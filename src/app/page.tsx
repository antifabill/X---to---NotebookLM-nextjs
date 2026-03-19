import { AppShell } from "@/components/app-shell";
import { driveConnectionStatus, listRecentJobs } from "@/lib/notebooklm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [recentJobs, driveState] = await Promise.all([listRecentJobs(), Promise.resolve(driveConnectionStatus())]);
  return <AppShell initialRecentJobs={recentJobs} driveState={driveState} />;
}

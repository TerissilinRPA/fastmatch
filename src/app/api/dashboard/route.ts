import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics";
import { loadJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await loadJobs();
  const { analyzed, stats } = buildDashboard(jobs);

  return NextResponse.json({
    meta: { total: jobs.length, generatedAt: new Date().toISOString() },
    stats,
    analyzed: analyzed.map((j) => ({
      ...j,
      description: j.description.slice(0, 220),
    })),
  });
}

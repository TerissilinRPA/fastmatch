import { NextResponse } from "next/server";
import { loadJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(5000, Math.max(1, Number(searchParams.get("limit") ?? 5000)));
  const jobs = await loadJobs();
  const slim = jobs.slice(0, limit).map((j) => ({
    ...j,
    description: j.description.slice(0, 280),
  }));

  return NextResponse.json({
    meta: { total: jobs.length, returned: slim.length },
    jobs: slim,
  });
}

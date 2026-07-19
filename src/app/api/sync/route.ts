import { NextResponse } from "next/server";
import { syncJobs } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    pageSize?: number;
    maxPages?: number;
  };

  const token = body.token || process.env.FASTWORK_TOKEN || "";
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing FASTWORK_TOKEN (body.token or env)" },
      { status: 400 },
    );
  }

  const result = await syncJobs({
    token,
    pageSize: body.pageSize ?? 50,
    maxPages: body.maxPages ?? 40,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

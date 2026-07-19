import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics";
import { loadJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const jobs = await loadJobs();
  const { analyzed, stats } = buildDashboard(jobs);

  if (id) {
    const job = analyzed.find((j) => j.id === id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ job, market: { tagMedian: job.tagMedian, priceBand: job.priceBand } });
  }

  const narrative = [
    `Fastmatch สำรวจงาน ${stats.total.toLocaleString()} รายการจาก Fastwork Job Board`,
    `เรทถูกกว่าตลาด (underpriced) ${stats.underpriced} งาน · เรทปกติ ${stats.fair} · แพงกว่าปกติ ${stats.overpriced} · ไม่ระบุงบ ${stats.unpriced}`,
    `AI แทนได้สูง ${stats.aiHigh} · ปานกลาง ${stats.aiMedium} · ต่ำ ${stats.aiLow}`,
    `งบมัธยฐานที่ระบุราคา ฿${Math.round(stats.medianBudget).toLocaleString()} (เฉลี่ย ฿${Math.round(stats.avgBudget).toLocaleString()})`,
    `โอกาสเด่น: งานที่ถูกกว่า median ของหมวด และ AI ช่วยทำได้ — พบ ${stats.opportunities.length} รายการในมุมมองปัจจุบัน`,
  ].join(" ");

  return NextResponse.json({
    narrative,
    stats,
    topOpportunities: stats.opportunities.slice(0, 12),
  });
}

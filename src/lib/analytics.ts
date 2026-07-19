import type { AnalyzedJob, DashboardStats, Job, PriceBand } from "./types";

const AI_HIGH = [
  "เขียน",
  "บทความ",
  "แปล",
  "content",
  "copy",
  "seo",
  "data entry",
  "excel",
  "สไลด์",
  "powerpoint",
  "รายงาน",
  "สรุป",
  "chatbot",
  "prompt",
  "transcript",
  "caption",
  "subtitle",
  "label",
  "coding",
  "โปรแกรม",
  "python",
  "javascript",
  "เว็บไซต์",
  "landing",
];

const AI_LOW = [
  "นวด",
  "ช่าง",
  "ติดตั้ง",
  "ซ่อม",
  "ขนส่ง",
  "ขับรถ",
  "ถ่ายทำ",
  "ถ่ายภาพนอกสถานที่",
  "จัดงาน",
  "พิธีกร",
  "สอนสด",
  "ติวเตอร์",
  "ทำความสะอาด",
  "ก่อสร้าง",
  "ช่างไฟ",
  "ช่างประปา",
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function tagMedians(jobs: Job[]): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const job of jobs) {
    if (!job.budget || job.budget <= 0) continue;
    const list = buckets.get(job.tag_name) ?? [];
    list.push(job.budget);
    buckets.set(job.tag_name, list);
  }
  const out = new Map<string, number>();
  for (const [tag, vals] of buckets) out.set(tag, median(vals));
  return out;
}

function priceBandFor(budget: number, tagMedian: number): { band: PriceBand; ratio: number } {
  if (!budget || budget <= 0 || !tagMedian) return { band: "unpriced", ratio: 0 };
  const ratio = budget / tagMedian;
  if (ratio <= 0.7) return { band: "underpriced", ratio };
  if (ratio >= 1.4) return { band: "overpriced", ratio };
  return { band: "fair", ratio };
}

function aiReplaceability(job: Job): {
  score: number;
  label: "high" | "medium" | "low";
  note: string;
} {
  const text = `${job.title} ${job.description} ${job.tag_name}`.toLowerCase();
  let score = 0.45;
  for (const k of AI_HIGH) if (text.includes(k.toLowerCase())) score += 0.08;
  for (const k of AI_LOW) if (text.includes(k.toLowerCase())) score -= 0.1;
  if (job.tag_name.includes("งานเขียน") || job.tag_name.includes("กราฟิก")) score += 0.12;
  if (job.tag_name.includes("ช่าง") || job.tag_name.includes("ไลฟ์สไตล์")) score -= 0.15;
  score = Math.max(0.05, Math.min(0.95, score));

  const label = score >= 0.65 ? "high" : score >= 0.4 ? "medium" : "low";
  const note =
    label === "high"
      ? "AI น่าจะช่วยผลิตงานร่าง/ตรวจแก้ได้มาก ควรเสนอแพ็กเกจ AI-assisted ที่ถูกและเร็ว"
      : label === "medium"
        ? "AI ช่วยบางส่วนได้ แต่ยังต้องมีคนรีวิวคุณภาพและบริบทลูกค้า"
        : "งานพึ่งทักษะกายภาพ/สถานที่/ความสัมพันธ์สูง AI แทนได้จำกัด";

  return { score, label, note };
}

function kmeans(
  points: number[][],
  k: number,
  maxIter = 25,
): { labels: number[]; centroids: number[][] } {
  if (points.length === 0) return { labels: [], centroids: [] };
  const dim = points[0]!.length;
  const centroids: number[][] = [];
  const step = Math.max(1, Math.floor(points.length / k));
  for (let i = 0; i < k; i += 1) {
    centroids.push([...(points[Math.min(points.length - 1, i * step)] ?? points[0]!)]);
  }

  let labels = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter += 1) {
    labels = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c += 1) {
        let d = 0;
        for (let j = 0; j < dim; j += 1) {
          const diff = p[j]! - centroids[c]![j]!;
          d += diff * diff;
        }
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    });

    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < points.length; i += 1) {
      const c = labels[i]!;
      counts[c] += 1;
      for (let j = 0; j < dim; j += 1) sums[c]![j] += points[i]![j]!;
    }
    for (let c = 0; c < k; c += 1) {
      if (!counts[c]) continue;
      for (let j = 0; j < dim; j += 1) centroids[c]![j] = sums[c]![j]! / counts[c];
    }
  }

  return { labels, centroids };
}

export function analyzeJobs(jobs: Job[], clusterCount = 5): AnalyzedJob[] {
  const medians = tagMedians(jobs);
  const tags = Array.from(new Set(jobs.map((j) => j.tag_name))).sort();
  const tagIndex = new Map(tags.map((t, i) => [t, i]));

  const points = jobs.map((job) => [
    Math.log1p(Math.max(0, job.budget)),
    (tagIndex.get(job.tag_name) ?? 0) / Math.max(1, tags.length - 1),
    Math.min(1, job.freelance_offers_count / 10),
  ]);

  const { labels } = kmeans(points, Math.min(clusterCount, Math.max(1, jobs.length)));

  return jobs.map((job, i) => {
    const tagMedian = medians.get(job.tag_name) ?? median(jobs.map((j) => j.budget).filter(Boolean));
    const { band, ratio } = priceBandFor(job.budget, tagMedian);
    const ai = aiReplaceability(job);
    return {
      ...job,
      priceBand: band,
      priceRatio: ratio,
      tagMedian,
      clusterId: labels[i] ?? 0,
      aiReplaceScore: ai.score,
      aiReplaceLabel: ai.label,
      aiNote: ai.note,
    };
  });
}

export function buildDashboard(jobs: Job[]): { analyzed: AnalyzedJob[]; stats: DashboardStats } {
  const analyzed = analyzeJobs(jobs);
  const priced = analyzed.filter((j) => j.priceBand !== "unpriced");
  const budgets = priced.map((j) => j.budget);
  const avgBudget = budgets.length ? budgets.reduce((a, b) => a + b, 0) / budgets.length : 0;

  const tagMap = new Map<string, AnalyzedJob[]>();
  for (const job of analyzed) {
    const list = tagMap.get(job.tag_name) ?? [];
    list.push(job);
    tagMap.set(job.tag_name, list);
  }

  const tagBars = Array.from(tagMap.entries())
    .map(([tag, list]) => ({
      tag,
      count: list.length,
      medianBudget: median(list.map((j) => j.budget).filter((b) => b > 0)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const clusterMap = new Map<number, AnalyzedJob[]>();
  for (const job of analyzed) {
    const list = clusterMap.get(job.clusterId) ?? [];
    list.push(job);
    clusterMap.set(job.clusterId, list);
  }

  const clusterBars = Array.from(clusterMap.entries())
    .map(([clusterId, list]) => {
      const tagCount = new Map<string, number>();
      for (const j of list) tagCount.set(j.tag_name, (tagCount.get(j.tag_name) ?? 0) + 1);
      const topTag = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
      const avg = list.reduce((s, j) => s + j.budget, 0) / Math.max(1, list.length);
      return { clusterId, count: list.length, avgBudget: avg, topTag };
    })
    .sort((a, b) => a.clusterId - b.clusterId);

  const dayMap = new Map<string, number>();
  for (const job of analyzed) {
    const day = (job.inserted_at || "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const dailyVolume = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  const opportunities = analyzed
    .filter((j) => j.priceBand === "underpriced" && j.aiReplaceLabel !== "low" && j.budget > 0)
    .sort((a, b) => b.aiReplaceScore - a.aiReplaceScore || a.priceRatio - b.priceRatio)
    .slice(0, 40);

  const stats: DashboardStats = {
    total: analyzed.length,
    priced: priced.length,
    underpriced: analyzed.filter((j) => j.priceBand === "underpriced").length,
    fair: analyzed.filter((j) => j.priceBand === "fair").length,
    overpriced: analyzed.filter((j) => j.priceBand === "overpriced").length,
    unpriced: analyzed.filter((j) => j.priceBand === "unpriced").length,
    aiHigh: analyzed.filter((j) => j.aiReplaceLabel === "high").length,
    aiMedium: analyzed.filter((j) => j.aiReplaceLabel === "medium").length,
    aiLow: analyzed.filter((j) => j.aiReplaceLabel === "low").length,
    avgBudget,
    medianBudget: median(budgets),
    tagBars,
    clusterBars,
    priceScatter: priced.slice(0, 400).map((j) => ({
      id: j.id,
      title: j.title,
      budget: j.budget,
      tagMedian: j.tagMedian,
      priceBand: j.priceBand,
      clusterId: j.clusterId,
    })),
    dailyVolume,
    opportunities,
  };

  return { analyzed, stats };
}

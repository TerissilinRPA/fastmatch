/**
 * Lightweight DIEL-inspired engine:
 * - events are logged (interaction + data arrival)
 * - output views are declarative queries over jobs + event history
 * - BindOutput-style subscribers re-render charts when views change
 */

import type { AnalyzedJob, DashboardStats, Job, PriceBand } from "./types";
import { buildDashboard } from "./analytics";

export type DielEvent =
  | { type: "data.loaded"; at: string; count: number }
  | { type: "sync.completed"; at: string; inserted: number; duplicateId?: string }
  | { type: "filter.tag"; at: string; tag: string | null }
  | { type: "filter.priceBand"; at: string; band: string | null }
  | { type: "filter.cluster"; at: string; clusterId: number | null }
  | { type: "brush.budget"; at: string; min: number | null; max: number | null };

export type DielState = {
  jobs: Job[];
  analyzed: AnalyzedJob[];
  stats: DashboardStats;
  events: DielEvent[];
  filters: {
    tag: string | null;
    priceBand: string | null;
    clusterId: number | null;
    budgetMin: number | null;
    budgetMax: number | null;
  };
  filtered: AnalyzedJob[];
};

type Listener = (state: DielState) => void;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function viewStats(rows: AnalyzedJob[]): DashboardStats {
  const priced = rows.filter((j) => j.priceBand !== "unpriced");
  const budgets = priced.map((j) => j.budget);

  const tagMap = new Map<string, AnalyzedJob[]>();
  for (const job of rows) {
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
  for (const job of rows) {
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
  for (const job of rows) {
    const day = (job.inserted_at || "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  return {
    total: rows.length,
    priced: priced.length,
    underpriced: rows.filter((j) => j.priceBand === "underpriced").length,
    fair: rows.filter((j) => j.priceBand === "fair").length,
    overpriced: rows.filter((j) => j.priceBand === "overpriced").length,
    unpriced: rows.filter((j) => j.priceBand === "unpriced").length,
    aiHigh: rows.filter((j) => j.aiReplaceLabel === "high").length,
    aiMedium: rows.filter((j) => j.aiReplaceLabel === "medium").length,
    aiLow: rows.filter((j) => j.aiReplaceLabel === "low").length,
    avgBudget: budgets.length ? budgets.reduce((a, b) => a + b, 0) / budgets.length : 0,
    medianBudget: median(budgets),
    tagBars,
    clusterBars,
    priceScatter: priced.slice(0, 400).map((j) => ({
      id: j.id,
      title: j.title,
      budget: j.budget,
      tagMedian: j.tagMedian,
      priceBand: j.priceBand as PriceBand,
      clusterId: j.clusterId,
    })),
    dailyVolume: Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30),
    opportunities: rows
      .filter((j) => j.priceBand === "underpriced" && j.aiReplaceLabel !== "low" && j.budget > 0)
      .sort((a, b) => b.aiReplaceScore - a.aiReplaceScore)
      .slice(0, 40),
  };
}

export class DielEngine {
  private state: DielState = {
    jobs: [],
    analyzed: [],
    stats: viewStats([]),
    events: [],
    filters: {
      tag: null,
      priceBand: null,
      clusterId: null,
      budgetMin: null,
      budgetMax: null,
    },
    filtered: [],
  };

  private listeners = new Set<Listener>();

  getState() {
    return this.state;
  }

  bindOutput(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  private derive() {
    const { analyzed, filters } = this.state;
    this.state.filtered = analyzed.filter((job) => {
      if (filters.tag && job.tag_name !== filters.tag) return false;
      if (filters.priceBand && job.priceBand !== filters.priceBand) return false;
      if (filters.clusterId != null && job.clusterId !== filters.clusterId) return false;
      if (filters.budgetMin != null && job.budget < filters.budgetMin) return false;
      if (filters.budgetMax != null && job.budget > filters.budgetMax) return false;
      return true;
    });
    this.state.stats = viewStats(this.state.filtered);
  }

  newEvent(event: DielEvent) {
    this.state.events = [event, ...this.state.events].slice(0, 80);

    switch (event.type) {
      case "filter.tag":
        this.state.filters.tag = event.tag;
        break;
      case "filter.priceBand":
        this.state.filters.priceBand = event.band;
        break;
      case "filter.cluster":
        this.state.filters.clusterId = event.clusterId;
        break;
      case "brush.budget":
        this.state.filters.budgetMin = event.min;
        this.state.filters.budgetMax = event.max;
        break;
      default:
        break;
    }

    this.derive();
    this.emit();
  }

  loadJobs(jobs: Job[]) {
    const { analyzed } = buildDashboard(jobs);
    this.state.jobs = jobs;
    this.state.analyzed = analyzed;
    this.state.filtered = analyzed;
    this.state.stats = viewStats(analyzed);
    const loaded: DielEvent = {
      type: "data.loaded",
      at: new Date().toISOString(),
      count: jobs.length,
    };
    this.state.events = [loaded, ...this.state.events].slice(0, 80);
    this.emit();
  }
}

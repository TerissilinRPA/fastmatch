/**
 * Lightweight DIEL-inspired engine:
 * - events are logged (interaction + data arrival)
 * - output views are declarative queries over jobs + event history
 * - BindOutput-style subscribers re-render charts when views change
 */

import type {
  AiLabel,
  AnalyzedJob,
  DashboardStats,
  Job,
  OpportunityPreset,
  OpportunitySort,
  PriceBand,
} from "./types";
import { buildDashboard } from "./analytics";

export type DielEvent =
  | { type: "data.loaded"; at: string; count: number }
  | { type: "sync.completed"; at: string; inserted: number; duplicateId?: string }
  | { type: "filter.tag"; at: string; tag: string | null }
  | { type: "filter.priceBand"; at: string; band: string | null }
  | { type: "filter.cluster"; at: string; clusterId: number | null }
  | { type: "filter.aiLabel"; at: string; label: AiLabel | null }
  | { type: "filter.search"; at: string; query: string }
  | { type: "filter.preset"; at: string; preset: OpportunityPreset }
  | { type: "filter.sort"; at: string; sort: OpportunitySort }
  | { type: "filter.limit"; at: string; limit: number }
  | { type: "brush.budget"; at: string; min: number | null; max: number | null }
  | { type: "filter.reset"; at: string };

export type DielFilters = {
  tag: string | null;
  priceBand: string | null;
  clusterId: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  aiLabel: AiLabel | null;
  search: string;
  preset: OpportunityPreset;
  sort: OpportunitySort;
  limit: number;
};

export type DielState = {
  jobs: Job[];
  analyzed: AnalyzedJob[];
  stats: DashboardStats;
  events: DielEvent[];
  filters: DielFilters;
  filtered: AnalyzedJob[];
};

type Listener = (state: DielState) => void;

export const OPPORTUNITY_PRESETS: {
  id: OpportunityPreset;
  label: string;
  hint: string;
}[] = [
  { id: "all", label: "ทุกโอกาส", hint: "เรียงตาม opportunity score" },
  {
    id: "expensive_ai",
    label: "จ้างแพง + AI ช่วยได้",
    hint: "แพงกว่าปกติ และ AI ช่วยทำได้",
  },
  {
    id: "cheap_ai",
    label: "จ้างถูก + AI ช่วยได้",
    hint: "ถูกกว่าตลาด และ AI ช่วยได้",
  },
  { id: "ai_high", label: "AI ทำแทนได้สูง", hint: "feasibility สูง" },
  { id: "overpriced", label: "จ้างแพงกว่าปกติ", hint: "งบสูงกว่า median หมวด" },
  { id: "underpriced", label: "จ้างถูกกว่าปกติ", hint: "งบต่ำกว่า median หมวด" },
  {
    id: "quick_win",
    label: "Quick win",
    hint: "value สูง + AI สูง",
  },
  {
    id: "automate_first",
    label: "Automate ก่อน",
    hint: "AI ≥ 75 และ value ≥ 50",
  },
];

const DEFAULT_FILTERS: DielFilters = {
  tag: null,
  priceBand: null,
  clusterId: null,
  budgetMin: null,
  budgetMax: null,
  aiLabel: null,
  search: "",
  preset: "all",
  sort: "opportunity",
  limit: 40,
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function matchesPreset(job: AnalyzedJob, preset: OpportunityPreset): boolean {
  const aiHelp = job.aiReplaceLabel === "high" || job.aiReplaceLabel === "medium";
  const aiPct = job.aiReplaceScore * 100;
  switch (preset) {
    case "all":
      return true;
    case "expensive_ai":
      return job.priceBand === "overpriced" && aiHelp && job.budget > 0;
    case "cheap_ai":
      return job.priceBand === "underpriced" && aiHelp && job.budget > 0;
    case "ai_high":
      return job.aiReplaceLabel === "high";
    case "overpriced":
      return job.priceBand === "overpriced";
    case "underpriced":
      return job.priceBand === "underpriced";
    case "quick_win":
      return job.businessValue >= 55 && aiPct >= 65 && job.budget > 0;
    case "automate_first":
      return aiPct >= 75 && job.businessValue >= 50 && job.budget > 0;
    default:
      return true;
  }
}

function sortJobs(rows: AnalyzedJob[], sort: OpportunitySort): AnalyzedJob[] {
  const copy = [...rows];
  switch (sort) {
    case "budget":
      return copy.sort((a, b) => (b.budget || 0) - (a.budget || 0));
    case "applicants":
      return copy.sort((a, b) => b.freelance_offers_count - a.freelance_offers_count);
    case "ai":
      return copy.sort((a, b) => b.aiReplaceScore - a.aiReplaceScore);
    case "opportunity":
    default:
      return copy.sort((a, b) => b.opportunityScore - a.opportunityScore);
  }
}

function viewStats(rows: AnalyzedJob[], filters: DielFilters): DashboardStats {
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

  const opportunities = sortJobs(rows.filter((j) => j.budget > 0), filters.sort).slice(
    0,
    filters.limit,
  );

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
    valueAiScatter: rows
      .filter((j) => j.budget > 0)
      .slice(0, 500)
      .map((j) => ({
        id: j.id,
        title: j.title,
        businessValue: j.businessValue,
        ai: Math.round(j.aiReplaceScore * 100),
        priceBand: j.priceBand,
        opportunityScore: j.opportunityScore,
        tag: j.tag_name,
      })),
    dailyVolume: Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30),
    opportunities,
  };
}

export class DielEngine {
  private state: DielState = {
    jobs: [],
    analyzed: [],
    stats: viewStats([], DEFAULT_FILTERS),
    events: [],
    filters: { ...DEFAULT_FILTERS },
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
    const q = filters.search.trim().toLowerCase();
    this.state.filtered = analyzed.filter((job) => {
      if (filters.tag && job.tag_name !== filters.tag) return false;
      if (filters.priceBand && job.priceBand !== filters.priceBand) return false;
      if (filters.clusterId != null && job.clusterId !== filters.clusterId) return false;
      if (filters.budgetMin != null && job.budget < filters.budgetMin) return false;
      if (filters.budgetMax != null && job.budget > filters.budgetMax) return false;
      if (filters.aiLabel && job.aiReplaceLabel !== filters.aiLabel) return false;
      if (q && !`${job.title} ${job.tag_name} ${job.description}`.toLowerCase().includes(q)) {
        return false;
      }
      if (!matchesPreset(job, filters.preset)) return false;
      return true;
    });
    this.state.stats = viewStats(this.state.filtered, filters);
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
      case "filter.aiLabel":
        this.state.filters.aiLabel = event.label;
        break;
      case "filter.search":
        this.state.filters.search = event.query;
        break;
      case "filter.preset":
        this.state.filters.preset = event.preset;
        // Preset owns price/AI combo — clear conflicting manual band/ai when applying named lens
        if (event.preset === "expensive_ai" || event.preset === "overpriced") {
          this.state.filters.priceBand = null;
        }
        if (event.preset === "cheap_ai" || event.preset === "underpriced") {
          this.state.filters.priceBand = null;
        }
        if (event.preset === "ai_high" || event.preset === "expensive_ai" || event.preset === "cheap_ai") {
          this.state.filters.aiLabel = null;
        }
        break;
      case "filter.sort":
        this.state.filters.sort = event.sort;
        break;
      case "filter.limit":
        this.state.filters.limit = event.limit;
        break;
      case "brush.budget":
        this.state.filters.budgetMin = event.min;
        this.state.filters.budgetMax = event.max;
        break;
      case "filter.reset":
        this.state.filters = { ...DEFAULT_FILTERS };
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
    this.state.stats = viewStats(analyzed, this.state.filters);
    const loaded: DielEvent = {
      type: "data.loaded",
      at: new Date().toISOString(),
      count: jobs.length,
    };
    this.state.events = [loaded, ...this.state.events].slice(0, 80);
    this.derive();
    this.emit();
  }
}

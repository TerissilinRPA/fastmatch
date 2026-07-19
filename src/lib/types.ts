export type Job = {
  id: string;
  title: string;
  status: string;
  kind: string;
  type: string;
  budget: number;
  tag_name: string;
  description: string;
  usage_type: string;
  freelance_offers_count: number;
  deadline_at: string;
  inserted_at: string;
  username: string;
  display_name: string;
  source: string;
};

export type PriceBand = "underpriced" | "fair" | "overpriced" | "unpriced";
export type AiLabel = "high" | "medium" | "low";

/** Named opportunity lenses (DIEL filter presets). */
export type OpportunityPreset =
  | "all"
  | "expensive_ai"
  | "cheap_ai"
  | "ai_high"
  | "overpriced"
  | "underpriced"
  | "quick_win"
  | "automate_first";

export type OpportunitySort = "opportunity" | "budget" | "applicants" | "ai";

export type AnalyzedJob = Job & {
  priceBand: PriceBand;
  priceRatio: number;
  tagMedian: number;
  clusterId: number;
  aiReplaceScore: number;
  aiReplaceLabel: AiLabel;
  aiNote: string;
  /** 0–100 business value proxy (demand × priced budget signal). */
  businessValue: number;
  /** 0–100 ranked opportunity score. */
  opportunityScore: number;
};

export type SyncResult = {
  ok: boolean;
  inserted: number;
  scanned: number;
  stoppedReason: "duplicate" | "exhausted" | "error";
  stoppedAtId?: string;
  duplicateId?: string;
  pagesFetched: number;
  totalInStore: number;
  newJobs: Job[];
  error?: string;
};

export type DashboardStats = {
  total: number;
  priced: number;
  underpriced: number;
  fair: number;
  overpriced: number;
  unpriced: number;
  aiHigh: number;
  aiMedium: number;
  aiLow: number;
  avgBudget: number;
  medianBudget: number;
  tagBars: { tag: string; count: number; medianBudget: number }[];
  clusterBars: { clusterId: number; count: number; avgBudget: number; topTag: string }[];
  priceScatter: {
    id: string;
    title: string;
    budget: number;
    tagMedian: number;
    priceBand: PriceBand;
    clusterId: number;
  }[];
  /** Business value × AI feasibility for quadrant chart. */
  valueAiScatter: {
    id: string;
    title: string;
    businessValue: number;
    ai: number;
    priceBand: PriceBand;
    opportunityScore: number;
    tag: string;
  }[];
  dailyVolume: { date: string; count: number }[];
  opportunities: AnalyzedJob[];
};

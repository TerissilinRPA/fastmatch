import { appendJobs, loadKnownIds, loadJobs } from "./store";
import type { Job, SyncResult } from "./types";

const BASE_URL = "https://jobboard-api.fastwork.co/api/jobs";

function toJob(raw: Record<string, unknown>): Job {
  const tag = (raw.tag as { name?: string } | null) ?? null;
  const profile = (raw.user_profile as { username?: string; display_name?: string } | null) ?? null;
  const budgetRaw = raw.budget ?? raw.budget_2 ?? 0;
  const budget = typeof budgetRaw === "number" ? budgetRaw : Number(budgetRaw) || 0;

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    status: String(raw.status ?? ""),
    kind: String(raw.kind ?? ""),
    type: String(raw.type ?? ""),
    budget,
    tag_name: String(tag?.name ?? "อื่นๆ"),
    description: String(raw.description ?? "").slice(0, 1200),
    usage_type: String(raw.usage_type ?? ""),
    freelance_offers_count: Number(raw.freelance_offers_count ?? 0) || 0,
    deadline_at: String(raw.deadline_at ?? ""),
    inserted_at: String(raw.inserted_at ?? ""),
    username: String(profile?.username ?? ""),
    display_name: String(profile?.display_name ?? ""),
    source: String(raw.source ?? ""),
  };
}

function buildUrl(page: number, pageSize: number): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  params.append("order_by[]", "inserted_at");
  params.append("order_directions[]", "desc");
  params.set("filters[0][field]", "kind");
  params.set("filters[0][value]", "standard");
  return `${BASE_URL}?${params.toString()}`;
}

async function fetchPage(token: string, page: number, pageSize: number) {
  const res = await fetch(buildUrl(page, pageSize), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "fastmatch-sync/1.0",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fastwork HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<{ data?: Record<string, unknown>[]; meta?: { total_pages?: number } }>;
}

/**
 * Incremental sync: newest-first. Stops as soon as a known job id appears.
 */
export async function syncJobs(options: {
  token: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<SyncResult> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 40;
  const known = await loadKnownIds();
  const insertedBatch: Job[] = [];
  let scanned = 0;
  let pagesFetched = 0;
  let stoppedReason: SyncResult["stoppedReason"] = "exhausted";
  let stoppedAtId: string | undefined;
  let duplicateId: string | undefined;
  let totalInStore = 0;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await fetchPage(options.token, page, pageSize);
      const rows = payload.data ?? [];
      pagesFetched += 1;
      if (rows.length === 0) break;

      for (const row of rows) {
        const job = toJob(row);
        if (!job.id) continue;
        scanned += 1;

        if (known.has(job.id)) {
          stoppedReason = "duplicate";
          stoppedAtId = job.id;
          duplicateId = job.id;
          // reconcile rule: first duplicate => stop paging
          page = maxPages + 1;
          break;
        }

        known.add(job.id);
        insertedBatch.push(job);
      }

      const totalPages = Number(payload.meta?.total_pages ?? 1);
      if (page >= totalPages) break;
      if (stoppedReason === "duplicate") break;
    }

    try {
      totalInStore = await appendJobs(insertedBatch);
    } catch (writeErr) {
      // Still succeed the reconcile; serverless may not persist across instances
      totalInStore = known.size;
      return {
        ok: true,
        inserted: insertedBatch.length,
        scanned,
        stoppedReason,
        stoppedAtId,
        duplicateId,
        pagesFetched,
        totalInStore,
        newJobs: insertedBatch,
        error:
          writeErr instanceof Error
            ? `persist_warning: ${writeErr.message}`
            : "persist_warning",
      };
    }

    return {
      ok: true,
      inserted: insertedBatch.length,
      scanned,
      stoppedReason,
      stoppedAtId,
      duplicateId,
      pagesFetched,
      totalInStore,
      newJobs: insertedBatch,
    };
  } catch (err) {
    const totalInStore = (await loadJobs()).length;
    return {
      ok: false,
      inserted: insertedBatch.length,
      scanned,
      stoppedReason: "error",
      stoppedAtId,
      duplicateId,
      pagesFetched,
      totalInStore,
      newJobs: insertedBatch,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

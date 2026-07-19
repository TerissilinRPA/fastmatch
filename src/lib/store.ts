import { promises as fs } from "fs";
import path from "path";
import type { Job } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SEED_PATH = path.join(DATA_DIR, "jobs.json");
const RUNTIME_PATH = path.join(DATA_DIR, "runtime-jobs.json");
const TMP_RUNTIME = path.join("/tmp", "fastmatch-runtime-jobs.json");

type StoreFile = {
  jobs: Job[];
  meta: {
    total: number;
    source?: string;
    updatedAt?: string;
  };
};

async function readJson(filePath: string): Promise<StoreFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as StoreFile;
  } catch {
    return null;
  }
}

async function writableRuntimePath(): Promise<string> {
  // Vercel / serverless filesystems are read-only except /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return TMP_RUNTIME;
  }
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DATA_DIR);
    return RUNTIME_PATH;
  } catch {
    return TMP_RUNTIME;
  }
}

export async function loadJobs(): Promise<Job[]> {
  const seed = (await readJson(SEED_PATH))?.jobs ?? [];
  const runtimePath = await writableRuntimePath();
  const runtime = (await readJson(runtimePath))?.jobs ?? [];

  const byId = new Map<string, Job>();
  for (const job of seed) byId.set(job.id, job);
  for (const job of runtime) byId.set(job.id, job);
  return Array.from(byId.values());
}

export async function loadKnownIds(): Promise<Set<string>> {
  const jobs = await loadJobs();
  return new Set(jobs.map((j) => j.id));
}

export async function appendJobs(newJobs: Job[]): Promise<number> {
  if (newJobs.length === 0) return (await loadJobs()).length;

  const runtimePath = await writableRuntimePath();
  const existing = (await readJson(runtimePath))?.jobs ?? [];
  const byId = new Map<string, Job>();
  for (const job of existing) byId.set(job.id, job);
  for (const job of newJobs) byId.set(job.id, job);

  const jobs = Array.from(byId.values());
  const payload: StoreFile = {
    jobs,
    meta: {
      total: jobs.length,
      source: "runtime-sync",
      updatedAt: new Date().toISOString(),
    },
  };

  await fs.mkdir(path.dirname(runtimePath), { recursive: true });
  await fs.writeFile(runtimePath, JSON.stringify(payload), "utf8");
  return (await loadJobs()).length;
}

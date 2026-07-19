"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { DielEngine, OPPORTUNITY_PRESETS, type DielState } from "@/lib/diel";
import type { AiLabel, AnalyzedJob, OpportunitySort, SyncResult } from "@/lib/types";

const BAND_COLOR: Record<string, string> = {
  underpriced: "#1FA6A0",
  fair: "#3D5A80",
  overpriced: "#E4572E",
  unpriced: "#8B9A9B",
};

const CLUSTER_COLORS = ["#1FA6A0", "#E4572E", "#3D5A80", "#F4A261", "#2A9D8F"];

function baht(n: number) {
  return `฿${Math.round(n).toLocaleString("th-TH")}`;
}

export function Dashboard() {
  const engineRef = useRef<DielEngine | null>(null);
  if (!engineRef.current) engineRef.current = new DielEngine();

  const [state, setState] = useState<DielState>(engineRef.current.getState());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string>("");
  const [token, setToken] = useState("");
  const [narrative, setNarrative] = useState("");
  const [selected, setSelected] = useState<AnalyzedJob | null>(null);

  useEffect(() => {
    const unbind = engineRef.current!.bindOutput(setState);
    return unbind;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [dashRes, analyzeRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/analyze"),
      ]);
      const dash = await dashRes.json();
      const analyze = await analyzeRes.json();
      if (cancelled) return;
      engineRef.current!.loadJobs(dash.analyzed ?? []);
      setNarrative(analyze.narrative ?? "");
      setLoading(false);
    })().catch((err) => {
      setSyncLog(String(err));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pricePie = useMemo(
    () => [
      { name: "จ้างถูก", key: "underpriced", value: state.stats.underpriced },
      { name: "เรทปกติ", key: "fair", value: state.stats.fair },
      { name: "แพงกว่าปกติ", key: "overpriced", value: state.stats.overpriced },
      { name: "ไม่ระบุงบ", key: "unpriced", value: state.stats.unpriced },
    ],
    [state.stats],
  );

  async function runSync() {
    setSyncing(true);
    setSyncLog("กำลังยิง Fastwork API...");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token || undefined, pageSize: 50, maxPages: 40 }),
      });
      const result = (await res.json()) as SyncResult;
      if (!result.ok) {
        setSyncLog(`Sync ล้มเหลว: ${result.error ?? "unknown"}`);
        setSyncing(false);
        return;
      }

      const msg =
        result.stoppedReason === "duplicate"
          ? `Reconcile หยุดเมื่อเจอ data ซ้ำ id=${result.duplicateId} · เพิ่มใหม่ ${result.inserted} · สแกน ${result.scanned} · หน้า ${result.pagesFetched}`
          : `Sync ครบช่วงที่ดึงได้ · เพิ่มใหม่ ${result.inserted} · สแกน ${result.scanned}`;
      setSyncLog(msg);

      engineRef.current!.newEvent({
        type: "sync.completed",
        at: new Date().toISOString(),
        inserted: result.inserted,
        duplicateId: result.duplicateId,
      });

      const dashRes = await fetch("/api/dashboard");
      const dash = await dashRes.json();
      engineRef.current!.loadJobs(dash.analyzed ?? []);
      const analyzeRes = await fetch("/api/analyze");
      const analyze = await analyzeRes.json();
      setNarrative(analyze.narrative ?? "");
    } catch (err) {
      setSyncLog(String(err));
    } finally {
      setSyncing(false);
    }
  }

  const diel = engineRef.current!;

  return (
    <div className="fm-shell">
      <header className="fm-hero">
        <div className="fm-hero-grid" aria-hidden />
        <div className="fm-hero-inner">
          <p className="fm-kicker">Job market intelligence</p>
          <h1 className="fm-brand">Fastmatch</h1>
          <p className="fm-lead">
            วิเคราะห์งาน Fastwork ด้วย DIEL views — clustering, เรทตลาด, และศักยภาพที่ AI ทำแทนได้
          </p>
          <div className="fm-cta-row">
            <button className="fm-btn primary" onClick={runSync} disabled={syncing || loading}>
              {syncing ? "Syncing…" : "Sync + Reconcile"}
            </button>
            <button
              className="fm-btn ghost"
              onClick={() =>
                diel.newEvent({ type: "filter.reset", at: new Date().toISOString() })
              }
            >
              Reset filters
            </button>
          </div>
        </div>
      </header>

      <section className="fm-panel sync-panel">
        <div className="fm-panel-head">
          <h2>API Sync</h2>
          <span>หยุดยิงเมื่อเจอ id ซ้ำ (newest-first reconcile)</span>
        </div>
        <div className="sync-row">
          <input
            className="fm-input"
            type="password"
            placeholder="Bearer token (optional if FASTWORK_TOKEN set)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="fm-btn primary" onClick={runSync} disabled={syncing}>
            {syncing ? "Working…" : "Test insert"}
          </button>
        </div>
        {syncLog ? <p className="sync-log">{syncLog}</p> : null}
      </section>

      {loading ? (
        <p className="fm-loading">กำลังโหลดและวิเคราะห์ข้อมูล…</p>
      ) : (
        <>
          <section className="fm-kpi-row">
            <Kpi label="Jobs" value={state.stats.total.toLocaleString()} />
            <Kpi label="จ้างถูก" value={String(state.stats.underpriced)} tone="good" />
            <Kpi label="เรทปกติ" value={String(state.stats.fair)} />
            <Kpi label="แพงกว่าปกติ" value={String(state.stats.overpriced)} tone="warn" />
            <Kpi label="AI แทนได้สูง" value={String(state.stats.aiHigh)} tone="good" />
            <Kpi label="Median budget" value={baht(state.stats.medianBudget)} />
          </section>

          <section className="fm-panel">
            <div className="fm-panel-head">
              <h2>AI market narrative</h2>
              <span>สรุปอัตโนมัติจาก clustering + pricing model</span>
            </div>
            <p className="narrative">{narrative}</p>
          </section>

          <section className="fm-grid-2">
            <div className="fm-panel chart-panel">
              <div className="fm-panel-head">
                <h2>Category volume</h2>
                <span>คลิกแท่งเพื่อ filter (DIEL event)</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={state.stats.tagBars}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                    <XAxis dataKey="tag" hide />
                    <YAxis />
                    <Tooltip
                      formatter={(v) => [v as number, "jobs"]}
                      labelFormatter={(l) => String(l)}
                    />
                    <Bar
                      dataKey="count"
                      fill="#1FA6A0"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const tag = (d as { tag?: string }).tag ?? null;
                        diel.newEvent({
                          type: "filter.tag",
                          at: new Date().toISOString(),
                          tag: state.filters.tag === tag ? null : tag,
                        });
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="chip-row">
                {state.stats.tagBars.slice(0, 8).map((t) => (
                  <button
                    key={t.tag}
                    className={`chip ${state.filters.tag === t.tag ? "active" : ""}`}
                    onClick={() =>
                      diel.newEvent({
                        type: "filter.tag",
                        at: new Date().toISOString(),
                        tag: state.filters.tag === t.tag ? null : t.tag,
                      })
                    }
                  >
                    {t.tag} · {t.count}
                  </button>
                ))}
              </div>
            </div>

            <div className="fm-panel chart-panel">
              <div className="fm-panel-head">
                <h2>Price bands</h2>
                <span>เทียบงบกับ median ของหมวด</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={pricePie}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const key = (d as { key?: string }).key ?? null;
                        diel.newEvent({
                          type: "filter.priceBand",
                          at: new Date().toISOString(),
                          band: state.filters.priceBand === key ? null : key,
                        });
                      }}
                    >
                      {pricePie.map((entry) => (
                        <Cell key={entry.key} fill={BAND_COLOR[entry.key]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="fm-grid-2">
            <div className="fm-panel chart-panel">
              <div className="fm-panel-head">
                <h2>K-means clusters</h2>
                <span>budget × category × offers</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={state.stats.clusterBars}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                    <XAxis dataKey="clusterId" tickFormatter={(v) => `C${v}`} />
                    <YAxis />
                    <Tooltip
                      formatter={(v, name) =>
                        name === "avgBudget" ? baht(Number(v)) : (v as number)
                      }
                    />
                    <Legend />
                    <Bar
                      dataKey="count"
                      name="jobs"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const clusterId = (d as { clusterId?: number }).clusterId;
                        diel.newEvent({
                          type: "filter.cluster",
                          at: new Date().toISOString(),
                          clusterId:
                            state.filters.clusterId === clusterId ? null : (clusterId ?? null),
                        });
                      }}
                    >
                      {state.stats.clusterBars.map((c) => (
                        <Cell
                          key={c.clusterId}
                          fill={CLUSTER_COLORS[c.clusterId % CLUSTER_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="cluster-list">
                {state.stats.clusterBars.map((c) => (
                  <li key={c.clusterId}>
                    <strong>C{c.clusterId}</strong> · {c.count} jobs · avg {baht(c.avgBudget)} · top{" "}
                    {c.topTag}
                  </li>
                ))}
              </ul>
            </div>

            <div className="fm-panel chart-panel">
              <div className="fm-panel-head">
                <h2>Budget vs category median</h2>
                <span>scatter · DIEL output view</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                    <XAxis type="number" dataKey="tagMedian" name="tag median" tickFormatter={(v) => `${v}`} />
                    <YAxis type="number" dataKey="budget" name="budget" tickFormatter={(v) => `${v}`} />
                    <ZAxis range={[40, 40]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v, name) =>
                        name === "budget" || name === "tagMedian" ? baht(Number(v)) : String(v)
                      }
                      labelFormatter={() => ""}
                      content={({ payload }) => {
                        const p = payload?.[0]?.payload as
                          | { title?: string; budget?: number; tagMedian?: number; priceBand?: string }
                          | undefined;
                        if (!p) return null;
                        return (
                          <div className="tip">
                            <div>{p.title}</div>
                            <div>
                              {baht(p.budget ?? 0)} vs median {baht(p.tagMedian ?? 0)} · {p.priceBand}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={state.stats.priceScatter}>
                      {state.stats.priceScatter.map((p) => (
                        <Cell key={p.id} fill={BAND_COLOR[p.priceBand] ?? "#888"} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="fm-panel chart-panel">
            <div className="fm-panel-head">
              <h2>Daily volume (30d)</h2>
              <span>inserted_at timeline</span>
            </div>
            <div className="chart-box tall">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={state.stats.dailyVolume}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#0B1F2A" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="fm-panel chart-panel">
            <div className="fm-panel-head">
              <h2>Business value × AI feasibility</h2>
              <span>ควอดแรนต์ · Deloitte-inspired screening</span>
            </div>
            <div className="chart-box tall">
              <ResponsiveContainer width="100%" height={340}>
                <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,31,42,0.08)" />
                  <XAxis
                    type="number"
                    dataKey="ai"
                    name="AI"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}`}
                    label={{ value: "AI automation →", position: "insideBottom", offset: -4, fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="businessValue"
                    name="Value"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}`}
                    label={{ value: "Business value →", angle: -90, position: "insideLeft", fontSize: 11 }}
                  />
                  <ZAxis range={[36, 36]} />
                  <Tooltip
                    content={({ payload }) => {
                      const p = payload?.[0]?.payload as
                        | {
                            title?: string;
                            ai?: number;
                            businessValue?: number;
                            priceBand?: string;
                            opportunityScore?: number;
                            tag?: string;
                          }
                        | undefined;
                      if (!p) return null;
                      return (
                        <div className="tip">
                          <div>
                            <strong>{p.tag}</strong>
                          </div>
                          <div>{p.title}</div>
                          <div>
                            AI {p.ai} · Value {p.businessValue} · Opp {p.opportunityScore} ·{" "}
                            {p.priceBand}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={state.stats.valueAiScatter}
                    cursor="pointer"
                    onClick={(d) => {
                      const id = (d as { id?: string }).id;
                      const job = state.filtered.find((j) => j.id === id) ?? null;
                      if (job) setSelected(job);
                    }}
                  >
                    {state.stats.valueAiScatter.map((p) => (
                      <Cell key={p.id} fill={BAND_COLOR[p.priceBand] ?? "#888"} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="chart-footnote">
              สีตามราคาเทียบกลุ่ม · มุมขวาบน = value สูง + AI ทำแทนได้มาก · มุมซ้ายบน = จ้างคน / AI
              ช่วย
            </p>
          </section>

          <section className="fm-panel">
            <div className="fm-panel-head">
              <h2>Opportunity desk</h2>
              <span>
                {state.stats.opportunities.length.toLocaleString("th-TH")} /{" "}
                {state.stats.total.toLocaleString("th-TH")} งาน · preset + search
              </span>
            </div>

            <div className="opp-presets" role="group" aria-label="กรองโอกาส">
              {OPPORTUNITY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  className={`opp-preset ${state.filters.preset === p.id ? "active" : ""}`}
                  onClick={() =>
                    diel.newEvent({
                      type: "filter.preset",
                      at: new Date().toISOString(),
                      preset: p.id,
                    })
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="opp-controls">
              <label className="opp-field grow">
                <span>ค้นหา</span>
                <input
                  className="fm-input"
                  type="search"
                  placeholder="เช่น content, website, admin"
                  value={state.filters.search}
                  onChange={(e) =>
                    diel.newEvent({
                      type: "filter.search",
                      at: new Date().toISOString(),
                      query: e.target.value,
                    })
                  }
                />
              </label>
              <label className="opp-field">
                <span>AI</span>
                <select
                  className="fm-select"
                  value={state.filters.aiLabel ?? "all"}
                  onChange={(e) => {
                    const v = e.target.value;
                    diel.newEvent({
                      type: "filter.aiLabel",
                      at: new Date().toISOString(),
                      label: v === "all" ? null : (v as AiLabel),
                    });
                  }}
                >
                  <option value="all">ทุกระดับ</option>
                  <option value="high">สูง</option>
                  <option value="medium">กลาง</option>
                  <option value="low">ต่ำ</option>
                </select>
              </label>
              <label className="opp-field">
                <span>เรียงตาม</span>
                <select
                  className="fm-select"
                  value={state.filters.sort}
                  onChange={(e) =>
                    diel.newEvent({
                      type: "filter.sort",
                      at: new Date().toISOString(),
                      sort: e.target.value as OpportunitySort,
                    })
                  }
                >
                  <option value="opportunity">Opportunity score</option>
                  <option value="budget">งบประมาณ</option>
                  <option value="applicants">จำนวนผู้สมัคร</option>
                  <option value="ai">AI feasibility</option>
                </select>
              </label>
              <label className="opp-field">
                <span>แสดง</span>
                <select
                  className="fm-select"
                  value={String(state.filters.limit)}
                  onChange={(e) =>
                    diel.newEvent({
                      type: "filter.limit",
                      at: new Date().toISOString(),
                      limit: Number(e.target.value),
                    })
                  }
                >
                  <option value="25">25</option>
                  <option value="40">40</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Tag</th>
                    <th>Budget</th>
                    <th>ราคาเทียบกลุ่ม</th>
                    <th>โอกาส</th>
                    <th>AI</th>
                    <th>ผู้สมัคร</th>
                  </tr>
                </thead>
                <tbody>
                  {state.stats.opportunities.map((job) => (
                    <tr key={job.id} onClick={() => setSelected(job)}>
                      <td>{job.title}</td>
                      <td>{job.tag_name}</td>
                      <td>{baht(job.budget)}</td>
                      <td>
                        <span className={`pill band-${job.priceBand}`}>
                          {job.priceBand === "overpriced"
                            ? "แพงกว่าปกติ"
                            : job.priceBand === "underpriced"
                              ? "ถูกกว่าปกติ"
                              : job.priceBand === "fair"
                                ? "เรทปกติ"
                                : "ไม่ระบุ"}
                        </span>
                      </td>
                      <td className="num">{job.opportunityScore}/100</td>
                      <td>
                        <span className={`pill ${job.aiReplaceLabel}`}>
                          {job.aiReplaceLabel} {(job.aiReplaceScore * 100).toFixed(0)}
                        </span>
                      </td>
                      <td className="num">{job.freelance_offers_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="chart-footnote">
              โมเดลคัดกรองเชิงกลยุทธ์: Business value × Automation feasibility — ไม่ใช่ราคามาตรฐานตลาด
              และงานที่ไม่ระบุงบจะไม่ถูกจัดว่าแพงหรือถูก
            </p>
          </section>

          <section className="fm-panel">
            <div className="fm-panel-head">
              <h2>DIEL event log</h2>
              <span>interaction + data arrival history</span>
            </div>
            <ul className="event-log">
              {state.events.slice(0, 12).map((ev, i) => (
                <li key={`${ev.type}-${i}`}>
                  <code>{ev.type}</code>
                  <span>{JSON.stringify(ev)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {selected ? (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <article className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{selected.title}</h3>
              <button className="fm-btn ghost" onClick={() => setSelected(null)}>
                Close
              </button>
            </header>
            <p className="meta-line">
              {selected.tag_name} · {baht(selected.budget)} · median {baht(selected.tagMedian)} ·{" "}
              {selected.priceBand} · Opportunity {selected.opportunityScore}/100
            </p>
            <p>{selected.description}</p>
            <div className="ai-box">
              <strong>บทวิเคราะห์ AI</strong>
              <p>
                คะแนนแทนที่ได้ {(selected.aiReplaceScore * 100).toFixed(0)}% ({selected.aiReplaceLabel}) —
                Business value {selected.businessValue}/100 — {selected.aiNote}
              </p>
              <p>
                มุมราคา: งบอยู่ที่ {(selected.priceRatio * 100).toFixed(0)}% ของ median หมวด —
                {selected.priceBand === "underpriced"
                  ? " จ้างถูกกว่าตลาด มีศักยภาพรับงาน"
                  : selected.priceBand === "overpriced"
                    ? " แพงกว่าปกติ — ถ้า AI ช่วยได้ คุ้มที่จะรับ"
                    : selected.priceBand === "fair"
                      ? " เรทปกติ"
                      : " ไม่ระบุงบ"}
              </p>
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

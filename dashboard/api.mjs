import fs from "node:fs";
import { openStore } from "../lib/store.mjs";
import { rankPools } from "../lib/ranking.mjs";
import { pickResumeMode } from "../lib/resume-builder.mjs";
import { statusLabel } from "../lib/application-tracker.mjs";

const DIRECTION_LABELS = { ai: "AI 应用", adas: "ADAS", softdev: "C++ 软开", agent: "Agent", both: "AI+ADAS", auto: "综合" };
const RESPONDED_STATUSES = ["assessment", "interview", "offer", "rejected", "withdrawn", "expired", "discarded"];
const ACTIVE_APPLIED_STATUSES = ["applied", "assessment", "interview", "offer"];

function directionOf(job) {
  const text = `${job.title || job.title_raw || ""} ${job.jd_text || job.description || ""}`;
  return pickResumeMode(text);
}

function toJobView(job) {
  const direction = directionOf(job);
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    city: job.city || job.location || null,
    posting_url: job.posting_url || null,
    apply_url: job.apply_url || null,
    source: job.source,
    source_confidence: job.source_confidence || null,
    published_at: job.published_at || null,
    deadline: job.deadline || null,
    status: job.status,
    first_seen_at: job.first_seen_at || null,
    direction,
    direction_label: DIRECTION_LABELS[direction] || "综合",
    eligibility_status: job.eligibility?.status || job.eligibility_status || null,
    eligibility_reason: job.eligibility?.reason || job.eligibility_reason || null,
    pool: job.pool || null,
    score: job.score || null
  };
}

export function loadDashboardData({ dbPath, preferencesPath, sourcesPath, now = new Date() }) {
  const store = openStore(dbPath);
  const rows = store.listJobs({});
  const blockedCompanies = store.listBlockedCompanies();
  const appRows = store.db.prepare("SELECT job_id, applied_at FROM applications").all();
  store.close();
  const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
  const sourcesConfig = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  // 实习/社招/已过期/无校招证据的岗位不再下发到前端（“已排除”只保留计数）
  const visibleRows = rows.filter((row) => row.eligibility_status !== "excluded");
  const jobs = visibleRows.map((row) => ({
    ...row,
    title_raw: row.title,
    company_raw: row.company,
    location_raw: row.location,
    eligibility: { status: row.eligibility_status, reason: row.eligibility_reason }
  }));
  const pools = rankPools(jobs, preferences);
  const scoreByJob = {};
  for (const poolName of ["linfen_area", "xian_core", "practice_city"]) {
    for (const job of pools[poolName] || []) scoreByJob[job.id] = job.score || null;
  }
  const today = now.toISOString().slice(0, 10);
  const statusCounts = {};
  for (const row of rows) {
    const key = row.status || "discovered";
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }
  const weekMs = 7 * 86400000;
  const weekStart = new Date(now.getTime() - weekMs);
  const appliedAt = new Map(appRows.map((a) => [a.job_id, a.applied_at]));
  const appliedJobs = rows.filter((r) => appliedAt.has(r.id));
  const activeAppliedList = appliedJobs
    .filter((r) => ACTIVE_APPLIED_STATUSES.includes(r.status))
    .map((r) => ({
      jobId: r.id,
      company: r.company,
      title: r.title,
      city: r.city || r.location || null,
      status: r.status,
      statusLabel: statusLabel(r.status),
      appliedAt: appliedAt.get(r.id)
    }))
    .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  const byDirection = {};
  for (const r of appliedJobs) {
    const label = DIRECTION_LABELS[directionOf(r)] || "综合";
    byDirection[label] = (byDirection[label] || 0) + 1;
  }
  const funnel = {};
  for (const s of ["applied", "assessment", "interview", "offer"]) funnel[s] = rows.filter((r) => r.status === s).length;
  const responded = appliedJobs.filter((r) => RESPONDED_STATUSES.includes(r.status)).length;
  return {
    generatedAt: now.toISOString(),
    totalJobs: rows.length,
    todayNew: rows.filter((row) => (row.first_seen_at || "").slice(0, 10) === today).length,
    excluded: rows.filter((row) => row.eligibility_status === "excluded").length,
    visibleJobs: visibleRows.length,
    statusCounts,
    weekly: {
      weekStart: weekStart.toISOString(),
      weekApplied: appliedJobs.filter((r) => new Date(appliedAt.get(r.id)) >= weekStart).length,
      totalApplied: appliedJobs.length,
      responded,
      responseRate: appliedJobs.length ? Math.round((responded / appliedJobs.length) * 100) : 0,
      byDirection,
      funnel,
      appliedJobs: activeAppliedList
    },
    pools: Object.fromEntries(Object.entries(pools).map(([name, list]) => [name, list.map(toJobView)])),
    jobs: visibleRows.map((row) => {
      const view = toJobView(row);
      view.score = scoreByJob[row.id] || null;
      return view;
    }),
    blockedCompanies,
    sources: sourcesConfig.sources || []
  };
}

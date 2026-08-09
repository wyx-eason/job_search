import fs from "node:fs";
import { openStore } from "../lib/store.mjs";
import { rankPools } from "../lib/ranking.mjs";

function toJobView(job) {
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
  store.close();
  const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
  const sourcesConfig = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  const jobs = rows.map((row) => ({
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
  return {
    generatedAt: now.toISOString(),
    totalJobs: rows.length,
    todayNew: rows.filter((row) => (row.first_seen_at || "").slice(0, 10) === today).length,
    excluded: rows.filter((row) => row.eligibility_status === "excluded").length,
    statusCounts,
    pools: Object.fromEntries(Object.entries(pools).map(([name, list]) => [name, list.map(toJobView)])),
    jobs: rows.map((row) => {
      const view = toJobView(row);
      view.score = scoreByJob[row.id] || null;
      return view;
    }),
    blockedCompanies,
    sources: sourcesConfig.sources || []
  };
}

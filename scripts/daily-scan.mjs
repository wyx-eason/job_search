import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { rankPools } from "../lib/ranking.mjs";
import { openStore } from "../lib/store.mjs";
import { runSourceAdapters } from "../lib/source-adapter.mjs";
import { renderDailyReport } from "./report.mjs";

export async function runDailyScan({ inputs = [], preferences, store, now = new Date(), extraJobs = [], extraFailures = [], onlineCount = 0 }) {
  const failures = [...extraFailures]; const collected = [...extraJobs];
  for (const input of inputs) {
    try { collected.push(...(Array.isArray(input) ? input : JSON.parse(fs.readFileSync(input, "utf8")))); }
    catch (error) { failures.push(`${input}: ${error.message}`); }
  }
  const jobs = mergeJobs(collected);
  for (const job of jobs) job.eligibility = classifyEligibility(job, now);
  const pools = rankPools(jobs, preferences);
  const persisted = store ? store.upsertJobs(jobs.map((job) => ({ ...job, ...job.eligibility }))) : null;
  const onlineText = onlineCount ? ` + ${onlineCount} 个在线来源` : "";
  return { pools, failures, persisted, sourceSummary: `读取 ${inputs.length} 个本地来源${onlineText}，标准化 ${jobs.length} 条岗位` };
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const input = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const online = process.argv.includes("--online");
  const root = path.resolve(import.meta.dirname, "..");
  const preferences = JSON.parse(fs.readFileSync(path.join(root, "candidate/preferences.json"), "utf8"));
  const store = openStore(path.join(root, "data/jobs.db"));
  const extraJobs = [];
  const extraFailures = [];
  let onlineCount = 0;
  if (online) {
    const sources = JSON.parse(fs.readFileSync(path.join(root, "config/sources.json"), "utf8")).sources.filter((s) => s.enabled && s.adapter);
    const results = await runSourceAdapters(sources);
    onlineCount = results.length;
    for (const result of results) {
      if (result.ok) extraJobs.push(...result.jobs);
      else extraFailures.push(`${result.source}: ${result.error}`);
    }
  }
  const result = await runDailyScan({ inputs: input ? [path.resolve(input)] : [], preferences, store, extraJobs, extraFailures, onlineCount });
  fs.mkdirSync(path.join(root, "reports/daily"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports/daily", `${new Date().toISOString().slice(0, 10)}.md`), renderDailyReport(result), "utf8");
  store.close(); console.log(JSON.stringify(result.persisted || {}, null, 2));
}

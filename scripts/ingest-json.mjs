import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { openStore } from "../lib/store.mjs";

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const input = process.argv[2];
  if (!input) throw new Error("用法: node scripts/ingest-json.mjs <岗位 JSON 文件>");
  const raw = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const jobs = mergeJobs(Array.isArray(raw) ? raw : raw.results || []);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  const store = openStore(path.resolve(import.meta.dirname, "../data/jobs.db"));
  const result = store.upsertJobs(jobs);
  store.close();
  console.log(JSON.stringify({ ...result, total: jobs.length }, null, 2));
}

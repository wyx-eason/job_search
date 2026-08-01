import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { openStore } from "../lib/store.mjs";

function fixture() {
  const jobs = mergeJobs([{ source: "official", source_job_id: "A1", company: "示例", title: "AI 工程师", city: "西安", description: "2027 届秋招", posting_url: "https://example.com/a" }]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  return jobs;
}

test("岗位写入幂等且保留来源", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-store-"));
  const store = openStore(path.join(dir, "jobs.db"));
  const jobs = fixture();
  assert.deepEqual(store.upsertJobs(jobs), { added: 1, updated: 0 });
  assert.deepEqual(store.upsertJobs(jobs), { added: 0, updated: 1 });
  assert.equal(store.listJobs().length, 1);
  assert.equal(store.listJobs()[0].eligibility_status, "eligible");
  store.close();
});

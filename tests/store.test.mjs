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
  assert.deepEqual(store.upsertJobs(jobs), { added: 1, updated: 0, blockedSkipped: 0, junkSkipped: 0 });
  assert.deepEqual(store.upsertJobs(jobs), { added: 0, updated: 1, blockedSkipped: 0, junkSkipped: 0 });
  assert.equal(store.listJobs().length, 1);
  assert.equal(store.listJobs()[0].eligibility_status, "eligible");
  store.close();
});

test("删除公司会移除全部岗位并屏蔽，屏蔽后不再重新入库", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-store-block-"));
  const store = openStore(path.join(dir, "jobs.db"));
  const jobs = fixture();
  assert.deepEqual(store.upsertJobs(jobs), { added: 1, updated: 0, blockedSkipped: 0, junkSkipped: 0 });
  const result = store.deleteJobsByCompany("示例");
  assert.equal(result.deleted, 1);
  assert.equal(store.listJobs().length, 0);
  store.blockCompany("示例");
  assert.deepEqual(store.upsertJobs(jobs), { added: 0, updated: 0, blockedSkipped: 1, junkSkipped: 0 });
  assert.equal(store.listJobs().length, 0);
  assert.equal(store.listBlockedCompanies().length, 1);
  assert.equal(store.unblockCompany("示例").removed, true);
  assert.deepEqual(store.upsertJobs(jobs), { added: 1, updated: 0, blockedSkipped: 0, junkSkipped: 0 });
  store.close();
});

test("屏蔽简称可拦截完整公司名", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-store-block2-"));
  const store = openStore(path.join(dir, "jobs.db"));
  const job = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "B2",
      company: "深圳云天励飞技术股份有限公司",
      title: "AI建模工程师",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://example.com/b"
    }
  ])[0];
  job.eligibility = classifyEligibility(job);
  store.blockCompany("云天励飞");
  assert.deepEqual(store.upsertJobs([job]), { added: 0, updated: 0, blockedSkipped: 1, junkSkipped: 0 });
  assert.equal(store.listJobs().length, 0);
  store.close();
});

test("占位/删除类岗位标题不入库", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-store-junk-"));
  const store = openStore(path.join(dir, "jobs.db"));
  const job = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "J1",
      company: "DJI大疆",
      title: "删除本条",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://example.com/j"
    }
  ])[0];
  job.eligibility = classifyEligibility(job);
  assert.deepEqual(store.upsertJobs([job]), { added: 0, updated: 0, blockedSkipped: 0, junkSkipped: 1 });
  assert.equal(store.listJobs().length, 0);
  store.close();
});

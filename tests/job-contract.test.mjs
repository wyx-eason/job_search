import test from "node:test";
import assert from "node:assert/strict";
import { classifyEligibility, jobFingerprint, mergeJobs, normalizeJob } from "../lib/job-contract.mjs";

const now = new Date("2026-08-01T00:00:00Z");

test("2027 届正式校招和提前批通过", () => {
  assert.equal(classifyEligibility(normalizeJob({ title: "AI 应用工程师", description: "2027 届秋招" }), now).status, "eligible");
  assert.equal(classifyEligibility(normalizeJob({ title: "ADAS 提前批", campus_year: 2027 }), now).status, "eligible");
});

test("实习、社招和过期岗位排除", () => {
  assert.equal(classifyEligibility(normalizeJob({ title: "算法实习生", description: "2027 届招聘" }), now).status, "excluded");
  assert.equal(classifyEligibility(normalizeJob({ title: "高级控制工程师", description: "社会招聘，3 年经验" }), now).status, "excluded");
  assert.equal(classifyEligibility(normalizeJob({ title: "控制工程师", description: "2027 届秋招", deadline: "2026-07-01" }), now).status, "excluded");
});

test("只有应届生字样时进入待确认", () => {
  const result = classifyEligibility(normalizeJob({ title: "控制工程师", description: "面向应届毕业生" }), now);
  assert.equal(result.status, "needs_cohort_confirmation");
});

test("同一岗位跨来源合并并保留来源链接", () => {
  const jobs = mergeJobs([
    { source: "official", source_job_id: "A1", company: "示例公司", title: "AI 工程师", city: "西安", description: "2027 届秋招", posting_url: "https://example.com/a", source_confidence: "high" },
    { source: "nowcoder", source_job_id: "A1", company: "示例公司", title: "AI 工程师", city: "西安", description: "2027 届秋招", posting_url: "https://nowcoder.com/a" }
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobFingerprint(jobs[0]), "source-id:a1");
  assert.deepEqual(jobs[0].source_urls.sort(), ["https://example.com/a", "https://nowcoder.com/a"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseYingjieshengJobPage } from "../lib/adapters/yingjiesheng.mjs";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";

test("应届生求职网岗位页解析出公司、标题、西安与学历要求", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/yingjiesheng-yuntian.html"), "utf8");
  const job = parseYingjieshengJobPage(html, "https://m.yingjiesheng.com/job-008-025-142.html");
  assert.equal(job.company, "深圳云天励飞技术股份有限公司");
  assert.equal(job.title, "2027校园招聘AI建模工程师");
  assert.equal(job.city, "西安");
  assert.equal(job.education, "硕士");
  assert.equal(job.published_at, "2026-08-07T00:00:00.000Z");
  assert.match(job.description, /40万元\/年/);
  assert.match(job.description, /需求专业：电子信息类/);
});

test("应届生求职网岗位通过资格判定进入 2027 校招池", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/yingjiesheng-yuntian.html"), "utf8");
  const job = parseYingjieshengJobPage(html, "https://m.yingjiesheng.com/job-008-025-142.html");
  const normalized = mergeJobs([job])[0];
  assert.equal(classifyEligibility(normalized).status, "eligible");
});

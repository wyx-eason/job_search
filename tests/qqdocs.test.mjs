import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseQqdocsSheet, qqdocsRowsToJobs } from "../lib/adapters/qqdocs.mjs";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";

// 固定判定基准时间，避免截止日期随真实日期推移导致用例失稳。
const now = new Date("2026-08-01T00:00:00Z");

test("腾讯文档智能表格解出字段化行数据", () => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/qqdocs-sheet.json"), "utf8");
  const rows = parseQqdocsSheet(fixture);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["公司名称"], "示例智驾公司");
  assert.equal(rows[0]["招聘岗位"], "ADAS 算法工程师（2027届提前批）");
  assert.equal(rows[0]["工作地点"], "西安");
  assert.equal(rows[0]["投递链接"], "https://example.com/apply/1");
  assert.match(rows[0]["方向"], /自动驾驶/);
});

test("腾讯文档行映射为岗位并通过资格判定（提前批入池、实习排除）", () => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/qqdocs-sheet.json"), "utf8");
  const rows = parseQqdocsSheet(fixture);
  const jobs = qqdocsRowsToJobs(rows, { tabId: "TAB", tabName: "测试表" });
  assert.equal(jobs.length, 2);
  const statuses = mergeJobs(jobs).map((job) => classifyEligibility(job, now).status);
  assert.deepEqual(statuses, ["eligible", "excluded"]);
});

test("腾讯文档中的占位行（如“删除本条”）不生成岗位", () => {
  const jobs = qqdocsRowsToJobs(
    [
      { "公司名称": "DJI大疆", "招聘岗位": "删除本条", "工作地点": "西安", "投递链接": "https://example.com/del" },
      { "公司名称": "示例公司", "招聘岗位": "AI 应用工程师", "工作地点": "西安", "投递链接": "https://example.com/ai" }
    ],
    { tabId: "TAB", tabName: "测试表" }
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "AI 应用工程师");
});

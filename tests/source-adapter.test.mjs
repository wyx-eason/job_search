import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseYunJiuyeJobPage } from "../lib/adapters/yunjiuye.mjs";
import { runSourceAdapters } from "../lib/source-adapter.mjs";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";

test("云就业岗位页解析出真实岗位且通过 2027 届资格判定", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/yunjiuye-job-3047001.html"), "utf8");
  const job = parseYunJiuyeJobPage(html, "https://job.xpu.edu.cn/detail/job?id=3047001");
  assert.equal(job.company, "卫宁健康科技集团股份有限公司");
  assert.equal(job.title, "实施工程师（技术专家方向）-27届-山西");
  assert.ok(job.location.includes("临汾市"));
  assert.ok(job.description.includes("岗位职责"));
  assert.ok(job.salary.includes("2K-4K"));
  assert.equal(job.source, "yunjiuye");
  const normalized = mergeJobs([job])[0];
  assert.equal(classifyEligibility(normalized).status, "eligible");
});

test("云就业多校实例解析多益网络 2027 提前批岗位", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/yunjiuye-gzzyy-2745424.html"), "utf8");
  const job = parseYunJiuyeJobPage(html, "http://gzzyy.bysjy.com.cn/detail/job?id=2745424&menu_id=");
  assert.equal(job.company, "多益网络有限公司");
  assert.ok(job.title.includes("2027届"));
  const normalized = mergeJobs([job])[0];
  assert.equal(classifyEligibility(normalized).status, "eligible");
});

test("来源适配器隔离单点失败", async () => {
  const registry = {
    ok1: { fetch: async () => [{ source: "ok1", title: "岗位A" }] },
    bad: { fetch: async () => { throw new Error("站点拒绝连接"); } }
  };
  const results = await runSourceAdapters(
    [{ id: "ok1", adapter: "ok1" }, { id: "bad", adapter: "bad" }],
    registry
  );
  assert.equal(results[0].ok, true);
  assert.equal(results[0].jobs.length, 1);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /站点拒绝连接/);
});

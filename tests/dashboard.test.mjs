import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { openStore } from "../lib/store.mjs";
import { createDashboardServer } from "../dashboard/server.mjs";

function fixture() {
  const raw = JSON.parse(fs.readFileSync(path.resolve("examples/jobs.fixture.json"), "utf8"));
  const jobs = mergeJobs(raw);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  return jobs;
}

async function withServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-dash-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  store.upsertJobs(fixture());
  store.close();
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0
  });
  const url = await server.listen();
  t.after(() => server.close());
  return url;
}

test("仪表盘页面可访问且包含中文标题", async (t) => {
  const url = await withServer(t);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /国内校招求职仪表盘/);
});

test("仪表盘接口返回三个排序池、待确认列表、全部岗位和来源健康", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/dashboard`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.totalJobs, 3);
  assert.equal(data.excluded, 1);
  assert.equal(data.jobs.length, 3);
  assert.equal(data.sources.length, 12);
  assert.deepEqual(
    data.pools.linfen_area.map((j) => j.title),
    ["自动化控制工程师"]
  );
  assert.deepEqual(
    data.pools.xian_core.map((j) => j.title),
    ["AI 应用工程师"]
  );
  assert.deepEqual(data.pools.practice_city, []);
  assert.deepEqual(data.pools.needs_confirmation, []);
  assert.ok(data.jobs.filter((j) => j.score && typeof j.score.total === "number").length >= 2);
});

test("仪表盘投递接口对不存在的岗位返回 404", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "not-exist" })
  });
  assert.equal(res.status, 404);
});

test("apply 接口成功时返回完整响应（会话、字段文件、导航信息）", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-apply-ok-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "T1",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/1#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "公司级岗位，请选择具体岗位", navigation: { matched: false, log: ["公司级汇总行"] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async () => fakeAssistant
  });
  const url = await server.listen();
  t.after(() => server.close());
  const res = await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sessionId, jobId);
  assert.equal(data.deferResume, true);
  assert.ok(data.formFieldsPath);
  assert.match(data.note, /公司级岗位/);
});

test("反馈接口：无会话返回 404，空意见返回 400", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-feedback-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "T2",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/2#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "公司级岗位", navigation: { matched: false, log: [] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async () => fakeAssistant
  });
  const url = await server.listen();
  t.after(() => server.close());
  const noSession = await fetch(`${url}/api/apply/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "none", feedback: "调整一下" })
  });
  assert.equal(noSession.status, 404);
  const applyRes = await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  const applyData = await applyRes.json();
  const empty = await fetch(`${url}/api/apply/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: applyData.sessionId, feedback: "   " })
  });
  assert.equal(empty.status, 400);
});

test("仪表盘接口返回投递状态计数", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/dashboard`);
  const data = await res.json();
  assert.equal(data.statusCounts.discovered, 3);
});

test("投递状态接口：合法流转更新状态，非法流转报错", async (t) => {
  const url = await withServer(t);
  const data = await (await fetch(`${url}/api/dashboard`)).json();
  const jobId = data.jobs[0].id;
  const ok = await fetch(`${url}/api/jobs/${jobId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "shortlisted" })
  });
  assert.equal(ok.status, 200);
  const bad = await fetch(`${url}/api/jobs/${jobId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "interview" })
  });
  assert.equal(bad.status, 400);
});

test("打开申请包接口拒绝越权路径", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/open-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packagePath: "C:/Windows" })
  });
  assert.equal(res.status, 400);
});

test("简历预览接口返回申请包内的简历 HTML 并拒绝越权路径", async (t) => {
  const url = await withServer(t);
  const pkgDir = path.join(path.resolve("output/applications"), `preview-test-${Date.now()}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "resume.html"), "<html><body>王奕迅 - 测试简历</body></html>", "utf8");
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  const ok = await fetch(`${url}/api/package/resume?packagePath=${encodeURIComponent(pkgDir)}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /王奕迅/);
  const bad = await fetch(`${url}/api/package/resume?packagePath=${encodeURIComponent("C:/Windows")}`);
  assert.equal(bad.status, 400);
  const missing = await fetch(`${url}/api/package/resume?packagePath=${encodeURIComponent(path.join(path.resolve("output/applications"), "no-such-pkg"))}`);
  assert.equal(missing.status, 404);
});

test("PDF 预览与页数接口返回真实页数并拒绝越权路径", async (t) => {
  const url = await withServer(t);
  const pkgDir = path.join(path.resolve("output/applications"), `preview-pdf-${Date.now()}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "resume.html"), "<html>ok</html>", "utf8");
  fs.writeFileSync(path.join(pkgDir, "resume.pdf"), "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n%%EOF", "utf8");
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  const pdf = await fetch(`${url}/api/package/pdf?packagePath=${encodeURIComponent(pkgDir)}`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
  const meta = await (await fetch(`${url}/api/package/meta?packagePath=${encodeURIComponent(pkgDir)}`)).json();
  assert.equal(meta.hasPdf, true);
  assert.equal(meta.pages, 2);
  const bad = await fetch(`${url}/api/package/pdf?packagePath=${encodeURIComponent("C:/Windows")}`);
  assert.equal(bad.status, 400);
});

test("删除公司接口移除岗位并加入屏蔽名单", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/companies/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "示例 AI 公司" })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.deleted, 1);
  assert.equal(data.blocked, "示例 AI 公司");
  const dash = await (await fetch(`${url}/api/dashboard`)).json();
  assert.equal(dash.totalJobs, 2);
  assert.equal(dash.blockedCompanies.length, 1);
});

test("恢复公司接口从屏蔽名单移除", async (t) => {
  const url = await withServer(t);
  await fetch(`${url}/api/companies/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "临汾示例制造企业" })
  });
  const res = await fetch(`${url}/api/companies/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "临汾示例制造企业" })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.removed, true);
  const dash = await (await fetch(`${url}/api/dashboard`)).json();
  assert.equal(dash.blockedCompanies.length, 0);
});

test("重新填表接口：无会话时返回 404", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/apply/refill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "no-session" })
  });
  assert.equal(res.status, 404);
});

test("按岗位重新生成简历接口：无会话时返回 404", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/apply/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "no-session" })
  });
  assert.equal(res.status, 404);
});

test("投递会话状态接口返回未打开会话", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/apply/status?jobId=none`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sessionOpen, false);
  assert.ok("lastAutoAttempt" in data);
  assert.ok("lastWatcherEvent" in data);
});

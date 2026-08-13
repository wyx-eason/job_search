import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { openStore } from "../lib/store.mjs";
import { createDashboardServer } from "../dashboard/server.mjs";

const config = JSON.parse(fs.readFileSync(path.resolve("config/apply.json"), "utf8"));
const require = createRequire(path.resolve(config.playwrightPackage));
const { chromium } = require("playwright");

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

test("apply 接口以手动模式启动投递助手（不自动导航、不自动填表、不预生成简历）", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-apply-manual-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "MANUAL1",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/manual#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  let captured = null;
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async (options) => {
      captured = options;
      return fakeAssistant;
    }
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
  assert.equal(data.deferResume, true);
  assert.equal(data.packagePath, null);
  assert.equal(captured.autoNavigate, false);
  assert.equal(captured.autoFill, false);
});

test("apply 助手返回前发生的岗位事件会在会话建立后重放", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-apply-events-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([{
    source: "qqdocs",
    source_job_id: "EARLY-EVENT",
    company: "测试公司",
    title: "研发类",
    city: "西安",
    description: "2027 届秋招",
    posting_url: "https://app.mokahr.com/campus_apply/test/early#/jobs"
  }]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const detailPage = {
    isClosed: () => false,
    url: () => "https://example.test/jobs/late-selected"
  };
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], navigation: { matched: false, log: [] } },
    page: detailPage,
    context: { close: async () => {} },
    watcher: { stop: () => {}, setResumePdfPath: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async (options) => {
      options.onJobSelection({ revision: 1 });
      options.onJobDetail({
        revision: 1,
        page: detailPage,
        url: detailPage.url(),
        jobTitle: "最后投递的算法工程师",
        pageText: "最后投递的算法工程师"
      });
      return fakeAssistant;
    }
  });
  const url = await server.listen();
  t.after(() => server.close());

  const applyRes = await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  assert.equal(applyRes.status, 200);
  const status = await (await fetch(`${url}/api/apply/status?jobId=${jobId}`)).json();
  assert.equal(status.lastWatcherEvent?.type, "jobDetail");
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

test("填表接口对当前活动页面填写表单", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-refill-active-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "REFILL1",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/refill#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "refill-page-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const formPage = await context.newPage();
  await formPage.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  const stalePage = await context.newPage();
  await stalePage.setContent("<h1>旧列表页</h1>");
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: stalePage,
    context,
    watcher: { stop: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async () => fakeAssistant,
    locateActivePage: async () => formPage
  });
  const url = await server.listen();
  t.after(() => server.close());
  await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  const res = await fetch(`${url}/api/apply/refill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: jobId })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.filled.some((f) => f.includes("姓名")));
  assert.equal(await formPage.inputValue("#name"), "王奕迅");
});

test("current-resume 无会话时返回 404", async (t) => {
  const url = await withServer(t);
  const res = await fetch(`${url}/api/apply/current-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "no-session" })
  });
  assert.equal(res.status, 404);
});

test("current-resume 当前页不是 JD 页时返回 400", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-current-resume-bad-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "CUR1",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/cur#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async () => fakeAssistant,
    locateActivePage: async () => ({ isClosed: () => false, url: () => "https://example.test/jobs" }),
    readPageText: async () => "职位列表\n搜索职位关键词"
  });
  const url = await server.listen();
  t.after(() => server.close());
  await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  const res = await fetch(`${url}/api/apply/current-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: jobId })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /JD 页/);
});

test("current-resume 对 JD 页生成申请包并记录会话", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-current-resume-ok-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "CUR2",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/cur2#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const pkgDir = path.join(path.resolve("output/applications"), `current-resume-test-${Date.now()}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "resume.pdf"), "%PDF-1.4 fake", "utf8");
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {}, setResumePdfPath: () => {} }
  };
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async () => fakeAssistant,
    locateActivePage: async () => ({ isClosed: () => false, url: () => "https://example.test/jobs/42/detail" }),
    readPageText: async () => "AI应用工程师\n岗位职责：负责大模型应用开发与 RAG 检索。\n任职要求：熟悉 Python 与 Agent。",
    generatePackage: async () => ({
      packagePath: pkgDir,
      files: ["resume.pdf"],
      qa: { ok: true, issues: [] },
      polish: null
    })
  });
  const url = await server.listen();
  t.after(() => server.close());
  await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  const res = await fetch(`${url}/api/apply/current-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: jobId })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.packagePath, pkgDir);
  assert.equal(data.qa.ok, true);
  assert.equal(data.jobTitle, "AI应用工程师");
});

test("current-resume 当前页非 JD 页时回退到已锁定岗位生成", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-current-resume-locked-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const jobs = mergeJobs([
    {
      source: "qqdocs",
      source_job_id: "CUR3",
      company: "测试公司",
      title: "产品开发类、研发类、职能类",
      city: "西安",
      description: "2027 届秋招",
      posting_url: "https://app.mokahr.com/campus_apply/test/cur3#/jobs"
    }
  ]);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const pkgDir = path.join(path.resolve("output/applications"), `current-resume-locked-test-${Date.now()}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "resume.pdf"), "%PDF-1.4 fake", "utf8");
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  const detailPage = {
    isClosed: () => false,
    url: () => "https://app.mokahr.com/campus_apply/test/cur3#/job/locked-1"
  };
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: { isClosed: () => false },
    context: { close: async () => {} },
    watcher: { stop: () => {}, setResumePdfPath: () => {} }
  };
  let fireJobDetail = null;
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0,
    applyAssistant: async (options) => {
      fireJobDetail = () =>
        options.onJobDetail({
          revision: 1,
          page: detailPage,
          url: detailPage.url(),
          jobTitle: "具身智能算法应用工程师",
          pageText: "具身智能算法应用工程师\n岗位职责：负责具身大模型应用开发与部署。\n任职要求：熟悉 Python、PyTorch 与 Agent。"
        });
      return fakeAssistant;
    },
    locateActivePage: async () => ({ isClosed: () => false, url: () => "https://app.mokahr.com/campus_apply/test/cur3#/job/locked-1/apply" }),
    readPageText: async () => "申请职位\n姓名：\n手机：\n邮箱：\n简历上传",
    generatePackage: async () => ({
      packagePath: pkgDir,
      files: ["resume.pdf"],
      qa: { ok: true, issues: [] },
      polish: null
    })
  });
  const url = await server.listen();
  t.after(() => server.close());
  await fetch(`${url}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  fireJobDetail();
  await new Promise((r) => setTimeout(r, 50));
  const res = await fetch(`${url}/api/apply/current-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: jobId })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.jobTitle, "具身智能算法应用工程师");
  assert.equal(data.packagePath, pkgDir);
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

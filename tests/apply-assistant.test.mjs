import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  loadCandidateAutofill,
  autofillApplyForm,
  waitAndAutofill,
  startFormWatcher,
  uploadResumeToForm,
  looksLikeApplyForm,
  prepareUploadResume,
  showBanner,
  loadFormValues,
  buildSelfEvaluation,
  buildAwardsSummary,
  loadCompleteFormValues,
  findActivePage,
  normalizeJobTitle,
  extractJobsFromApiPayload
} from "../lib/apply-assistant.mjs";

const config = JSON.parse(fs.readFileSync(path.resolve("config/apply.json"), "utf8"));
const require = createRequire(path.resolve(config.playwrightPackage));
const { chromium } = require("playwright");

test("候选人安全字段从简历与配置中提取", () => {
  const candidate = loadCandidateAutofill();
  assert.equal(candidate.name, "王奕迅");
  assert.equal(candidate.email, "redacted@example.com");
  assert.equal(candidate.phone, "13800000000");
  assert.equal(candidate.university, "西安电子科技大学");
  assert.equal(candidate.degree, "硕士");
  assert.equal(candidate.major, "控制科学与工程");
  assert.equal(candidate.graduation, "2027-06");
});

test("投递助手填写安全字段、跳过敏感字段且不提交", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await autofillApplyForm(page, candidate);

  assert.equal(await page.inputValue("#name"), "王奕迅");
  assert.equal(await page.inputValue("#phone"), "13800000000");
  assert.equal(await page.inputValue("#email"), "redacted@example.com");
  assert.equal(await page.inputValue("#university"), "西安电子科技大学");
  assert.equal(await page.inputValue("#degree"), "2"); // 硕士
  assert.equal(await page.inputValue("#major"), candidate.major);
  assert.equal(await page.inputValue("#graduation"), "2027-06");

  assert.equal(await page.inputValue("#idcard"), "");
  assert.equal(await page.inputValue("#political"), "");
  assert.equal(await page.inputValue("#salary"), "");
  assert.equal(await page.inputValue("#address"), "");
  assert.equal(await page.evaluate(() => window.__submitted), undefined);
  assert.equal(result.submitted, false);
  assert.ok(result.filled.some((f) => f.includes("姓名")));
  assert.ok(result.skippedSensitive.some((f) => f.includes("身份证")));
});

test("投递助手能穿透 iframe 填写表单", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form-iframe.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await autofillApplyForm(page, candidate);
  assert.equal(result.filled.length > 0, true);
  const iframe = page.frames().find((f) => f !== page.mainFrame());
  assert.equal(await iframe.inputValue("#name"), "王奕迅");
  assert.equal(await iframe.inputValue("#idcard"), "");
  assert.ok(result.formFields.length > 0);
});

test("无表单页面在超时后返回明确提示", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-noform.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await waitAndAutofill(page, candidate, 100);
  assert.match(result.note, /未能自动识别|未检测到可填写的申请表单/);
  assert.equal(result.filled.length, 0);
});

test("分步表单：后续步骤字段出现后继续自动填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-steps.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await waitAndAutofill(page, candidate, 8000);
  assert.equal(await page.inputValue("#name"), "王奕迅");
  assert.equal(await page.inputValue("#university"), "西安电子科技大学");
  assert.equal(await page.inputValue("#degree"), "2");
  assert.ok(result.filled.length >= 1);
});

test("投递助手自动上传简历文件", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await autofillApplyForm(page, candidate, {
    resumePdfPath: path.resolve("tests/fixtures/apply-form.html")
  });
  assert.equal(result.uploadedResume, true);
  const files = await page.evaluate(() => {
    const input = document.querySelector("input[type=file]");
    return input ? input.files.length : 0;
  });
  assert.equal(files, 1);
});

test("等待表单期间岗位切换后不上传启动时的旧简历", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent("<h1>岗位详情</h1>");
  let currentResumePdfPath = path.resolve("tests/fixtures/apply-form.html");
  setTimeout(() => {
    currentResumePdfPath = null;
    page.setContent(`
      <label>姓名 <input id="name" name="name"></label>
      <label>手机号 <input id="phone" name="phone"></label>
      <label>简历 <input id="resume" name="resume" type="file"></label>
    `).catch(() => {});
  }, 300);

  await waitAndAutofill(page, loadCandidateAutofill(), 4000, {
    resumePdfPath: path.resolve("tests/fixtures/apply-form.html"),
    getResumePdfPath: () => currentResumePdfPath
  });

  assert.equal(await page.inputValue("#name"), "王奕迅");
  assert.equal(await page.evaluate(() => document.querySelector("#resume").files.length), 0);
});

test("投递助手能穿透 shadow DOM 填写表单", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-shadow.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await autofillApplyForm(page, candidate);
  const values = await page.evaluate(() => {
    const root = document.querySelector("custom-form").shadowRoot;
    return { name: root.querySelector("#name").value, phone: root.querySelector("#phone").value };
  });
  assert.equal(values.name, "王奕迅");
  assert.equal(values.phone, "13800000000");
  assert.ok(result.filled.length >= 2);
});

test("持续监听器在表单延迟出现后自动填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-late.html")).href);
  const candidate = loadCandidateAutofill();
  const watcher = startFormWatcher({
    page,
    candidate,
    pollIntervalMs: 1500,
    maxPolls: 6
  });
  t.after(() => watcher.stop());
  await page.waitForTimeout(7000);
  assert.equal(await page.inputValue("#name"), "王奕迅");
  assert.equal(await page.inputValue("#phone"), "13800000000");
});

test("监听器识别非 ATS 岗位详情页（含 JD 标记）并触发重生成", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href);
  let fired = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: () => { fired++; },
    onApplyForm: () => {},
    pollIntervalMs: 300,
    maxPolls: 4
  });
  await page.waitForTimeout(500);
  await page.click("#apply");
  await page.waitForTimeout(1600);
  watcher.stop();
  assert.ok(fired >= 1, "应识别 JD 详情页并触发重生成");
});

test("监听器能穿透 shadow DOM 读取岗位详情", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/jd-shadow.html")).href);
  let fired = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: () => { fired++; },
    onApplyForm: () => {},
    pollIntervalMs: 300,
    maxPolls: 4
  });
  await page.waitForTimeout(500);
  await page.click("#apply");
  await page.waitForTimeout(1600);
  watcher.stop();
  assert.ok(fired >= 1, "shadow DOM 里的 JD 也应被识别");
});

test("监听器扫描上下文所有标签页，新标签页里的岗位详情也能触发", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  let fired = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: () => { fired++; },
    onApplyForm: () => {},
    pollIntervalMs: 300,
    maxPolls: 6
  });
  await watcher.ready;
  const jobTab = await context.newPage();
  await jobTab.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href);
  await page.waitForTimeout(500);
  await jobTab.click("#apply");
  await page.waitForTimeout(1800);
  watcher.stop();
  assert.ok(fired >= 1, "新标签页里的 JD 详情应被识别");
});

test("未点击任何岗位时不触发自动重生成（避免列表页误触发）", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href);
  let fired = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: () => { fired++; },
    onApplyForm: () => {},
    pollIntervalMs: 300,
    maxPolls: 4
  });
  await page.waitForTimeout(1600);
  watcher.stop();
  assert.equal(fired, 0, "没有点击岗位卡片时不应触发");
});

test("只锁定最后点击投递的岗位详情，列表页和未投递详情不能覆盖", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const listPage = await context.newPage();
  await listPage.setContent("<h1>职位列表</h1><a id='card'>产品经理</a>");
  const oldDetail = await context.newPage();
  await oldDetail.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=old");
  const newDetail = await context.newPage();
  await newDetail.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=new");
  await newDetail.locator("h1").evaluate((el) => { el.textContent = "具身大模型算法实习生"; });

  const locked = [];
  const watcher = startFormWatcher({
    page: listPage,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: (event) => locked.push(event),
    onApplyForm: () => {},
    pollIntervalMs: 200,
    maxPolls: 15
  });
  t.after(() => watcher.stop());

  await oldDetail.click("h1");
  await newDetail.click("h1");
  await listPage.waitForTimeout(500);
  assert.equal(locked.length, 0, "只浏览详情时不应锁定岗位");

  await newDetail.click("#apply");
  await listPage.waitForTimeout(800);
  assert.equal(locked.length, 1);
  assert.equal(locked[0].jobTitle, "具身大模型算法实习生");
  assert.match(locked[0].url, /job=new/);
});

test("同一轮内连续投递两个详情时按真实点击时间锁定最后一个", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const rootPage = await context.newPage();
  await rootPage.setContent("<h1>职位列表</h1>");
  const firstDetail = await context.newPage();
  await firstDetail.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=first");
  await firstDetail.locator("h1").evaluate((el) => { el.textContent = "最后选择的算法工程师"; });
  const secondDetail = await context.newPage();
  await secondDetail.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=second");
  await secondDetail.locator("h1").evaluate((el) => { el.textContent = "先选择的产品经理"; });

  const locked = [];
  const watcher = startFormWatcher({
    page: rootPage,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: (event) => locked.push(event),
    onApplyForm: () => {},
    pollIntervalMs: 800,
    maxPolls: 8
  });
  t.after(() => watcher.stop());
  await rootPage.waitForTimeout(900);

  await secondDetail.click("#apply");
  await firstDetail.click("#apply");
  await rootPage.waitForTimeout(1600);

  assert.equal(locked.at(-1)?.jobTitle, "最后选择的算法工程师");
  assert.match(locked.at(-1)?.url || "", /job=first/);
});

test("跨页面投递事件倒序到达时仍锁定浏览器中最后点击的岗位", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const rootPage = await context.newPage();
  await rootPage.setContent("<h1>职位列表</h1>");
  const olderPage = await context.newPage();
  await olderPage.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=older");
  const newerPage = await context.newPage();
  await newerPage.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=newer");
  const locked = [];
  const watcher = startFormWatcher({
    page: rootPage,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: (event) => locked.push(event),
    onApplyForm: () => {},
    pollIntervalMs: 500,
    maxPolls: 8
  });
  t.after(() => watcher.stop());
  await watcher.ready;

  const pageText = await newerPage.locator("body").innerText();
  await newerPage.evaluate(({ pageText }) => window.__applyAssistantCommitJob({
    url: location.href,
    jobTitle: "后点击的算法工程师",
    pageText,
    clickedAt: 2000,
    commitSequence: 1
  }), { pageText });
  await olderPage.evaluate(({ pageText }) => window.__applyAssistantCommitJob({
    url: location.href,
    jobTitle: "先点击的产品经理",
    pageText,
    clickedAt: 1000,
    commitSequence: 1
  }), { pageText });
  await rootPage.waitForTimeout(700);

  assert.equal(locked.at(-1)?.jobTitle, "后点击的算法工程师");
  assert.match(locked.at(-1)?.url || "", /job=newer/);
});

test("已填写字段不被覆盖，重复扫描不重复填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  await page.fill("#name", "手动填写");
  const candidate = loadCandidateAutofill();
  const r1 = await autofillApplyForm(page, candidate);
  assert.equal(await page.inputValue("#name"), "手动填写");
  assert.ok(!r1.filled.some((f) => f.includes("姓名")));
  const r2 = await autofillApplyForm(page, candidate);
  assert.equal(r2.filled.length, 0);
});

test("用户手动修改的字段不再被自动填充覆盖，清空后也不回填", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  const candidate = loadCandidateAutofill();
  await autofillApplyForm(page, candidate);
  assert.ok((await page.inputValue("#phone")).length > 0, "手机号已被自动填充");
  await page.click("#phone");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("13900001111");
  assert.equal(await page.inputValue("#phone"), "13900001111");
  const r1 = await autofillApplyForm(page, candidate);
  assert.ok(r1.userEdited >= 1, "识别到用户修改");
  assert.equal(await page.inputValue("#phone"), "13900001111", "修改后的手机号不被覆盖");
  await page.click("#phone");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  assert.equal(await page.inputValue("#phone"), "");
  const r2 = await autofillApplyForm(page, candidate);
  assert.equal(await page.inputValue("#phone"), "", "清空后不回填");
  assert.ok(r2.userEdited >= 1);
});

test("上传简历助手可直接替换表单文件", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href);
  const ok = await uploadResumeToForm(page, path.resolve("tests/fixtures/apply-form.html"));
  assert.equal(ok, true);
  const files = await page.evaluate(() => document.querySelector("input[type=file]").files.length);
  assert.equal(files, 1);
});

test("normalizeJobTitle 忽略标点与届别后缀", () => {
  assert.equal(
    normalizeJobTitle("AI大模型算法工程师（应用方向）-27届秋招"),
    normalizeJobTitle("AI大模型算法工程师（应用方向）27届秋招")
  );
  assert.equal(normalizeJobTitle("安全工程师AI技术方向"), normalizeJobTitle("安全工程师（AI技术方向）"));
});

test("extractJobsFromApiPayload 提取岗位标题与 JD", () => {
  const payload = {
    Data: [
      { JobAdName: "安全工程师（AI技术方向）-27届秋招", Duty: "工作职责：负责安全体系设计与漏洞分析。", Require: "任职要求：熟悉网络安全与 AI。", Id: "x1" }
    ]
  };
  const jobs = extractJobsFromApiPayload(payload);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "安全工程师（AI技术方向）-27届秋招");
  assert.match(jobs[0].jd, /工作职责/);
  assert.match(jobs[0].jd, /任职要求/);
  assert.equal(jobs[0].id, "x1");
});

test("识别申请表单字段组合（区别于搜索框）", () => {
  assert.equal(looksLikeApplyForm([{ placeholder: "请输入姓名" }, { placeholder: "推荐码" }, { name: "resumeKey" }]), true);
  assert.equal(looksLikeApplyForm([{ placeholder: "搜索职位关键词" }]), false);
});

test("读取表单补充字段配置", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "form-values-"));
  const file = path.join(dir, "values.yml");
  fs.writeFileSync(file, "# 注释\nfields:\n  政治面貌: 共青团员\n  民族: 汉族\n", "utf8");
  const values = loadFormValues(file);
  assert.equal(values["政治面貌"], "共青团员");
  assert.equal(values["民族"], "汉族");
});

test("自动生成自我评价与获奖情况摘要", () => {
  const selfEvaluation = buildSelfEvaluation();
  const awards = buildAwardsSummary();
  assert.ok(selfEvaluation.includes("双方向"));
  assert.ok(selfEvaluation.includes("SCI"));
  assert.ok(awards.includes("智能汽车竞赛"));
  assert.ok(awards.includes("二等奖学金"));
  const complete = loadCompleteFormValues();
  assert.equal(complete["自我评价"], selfEvaluation);
  assert.equal(complete["获奖情况"], awards);
});

test("用户授权字段（含敏感字段）按补充表填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  const candidate = loadCandidateAutofill();
  const result = await autofillApplyForm(page, candidate, {
    formValues: { 政治面貌: "共青团员", 民族: "汉族" }
  });
  assert.equal(await page.inputValue("#political"), "共青团员");
  assert.equal(await page.inputValue("#idcard"), "");
  assert.ok(result.filled.some((f) => f.includes("政治面貌")));
});

test("自我评价与获奖情况字段自动填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-extra.html")).href);
  const candidate = loadCandidateAutofill();
  const complete = loadCompleteFormValues();
  const result = await autofillApplyForm(page, candidate, { formValues: complete });
  const selfEval = await page.inputValue("#selfEval");
  const awards = await page.inputValue("#awards");
  assert.ok(selfEval.includes("AI 应用"));
  assert.ok(awards.includes("智能汽车竞赛"));
  assert.ok(result.filled.some((f) => f.includes("自我评价")));
  assert.ok(result.filled.some((f) => f.includes("获奖情况")));
});

test("上传简历副本使用姓名+公司+岗位命名", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-name-"));
  fs.writeFileSync(path.join(dir, "resume.pdf"), "pdf-content");
  const dest = prepareUploadResume(dir, "元戎启行", "系统评测工程师");
  assert.ok(fs.existsSync(dest));
  assert.match(path.basename(dest), /王奕迅_系统评测工程师/);
  assert.ok(!path.basename(dest).includes("元戎启行"));
});

test("岗位名异常时文件名不含板块名", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-name-"));
  fs.writeFileSync(path.join(dir, "resume.pdf"), "pdf-content");
  const dest = prepareUploadResume(dir, "元戎启行", "实习经历");
  assert.ok(!path.basename(dest).includes("实习经历"));
  assert.ok(path.basename(dest).includes("王奕迅"));
});

test("汇总类岗位名回退为公司名", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-name-"));
  fs.writeFileSync(path.join(dir, "resume.pdf"), "pdf-content");
  const dest = prepareUploadResume(dir, "元戎启行", "算法类、研发工程类、产品类、职能支持类等");
  assert.equal(path.basename(dest), "王奕迅_元戎启行.pdf");
});

test("投递页内横幅提示注入", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href);
  await showBanner(page, "测试横幅");
  const found = await page.evaluate(() => Boolean(document.getElementById("apply-assistant-banner")));
  assert.equal(found, true);
});

test("申请表单在新标签页时也会被自动填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const listPage = await context.newPage();
  await listPage.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href);
  const watcher = startFormWatcher({
    page: listPage,
    candidate: loadCandidateAutofill(),
    onFieldsChange: () => {},
    onJobDetail: () => {},
    onApplyForm: () => {},
    pollIntervalMs: 300,
    maxPolls: 8
  });
  const formTab = await context.newPage();
  await formTab.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  await listPage.waitForTimeout(2200);
  watcher.stop();
  assert.equal(await formTab.inputValue("#name"), "王奕迅", "新标签页表单应被自动填写");
  assert.equal(await formTab.inputValue("#phone"), "13800000000");
});

test("延迟出现的表单使用监听器更新后的简历路径自动填写并上传", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const listPage = await context.newPage();
  await listPage.setContent("<h1>职位列表</h1>");
  const watcher = startFormWatcher({
    page: listPage,
    candidate: loadCandidateAutofill(),
    resumePdfPath: null,
    onFieldsChange: () => {},
    onJobDetail: () => {},
    onApplyForm: () => {},
    pollIntervalMs: 200,
    maxPolls: 15
  });
  t.after(() => watcher.stop());
  watcher.setResumePdfPath(path.resolve("tests/fixtures/apply-form.html"));

  const formTab = await context.newPage();
  await formTab.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href);
  await listPage.waitForTimeout(900);

  assert.equal(await formTab.inputValue("#name"), "王奕迅");
  assert.equal(await formTab.evaluate(() => document.querySelector("#resume").files.length), 1);
});

test("切换岗位后旧表单不接收新简历，新表单等待并上传新岗位简历", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const rootPage = await context.newPage();
  await rootPage.setContent("<h1>职位列表</h1>");
  const oldForm = await context.newPage();
  await oldForm.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href + "?job=old");
  const watcher = startFormWatcher({
    page: rootPage,
    candidate: loadCandidateAutofill(),
    resumePdfPath: path.resolve("tests/fixtures/apply-form.html"),
    onFieldsChange: () => {},
    onJobDetail: () => {},
    onApplyForm: () => {},
    pollIntervalMs: 200,
    maxPolls: 20
  });
  t.after(() => watcher.stop());
  await rootPage.waitForTimeout(1200);
  assert.equal(await oldForm.evaluate(() => document.querySelector("#resume").files[0]?.name), "apply-form.html");

  const newDetail = await context.newPage();
  await newDetail.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href + "?job=new");
  await newDetail.click("#apply");
  const newForm = await context.newPage();
  await newForm.goto(pathToFileURL(path.resolve("tests/fixtures/apply-upload.html")).href + "?job=new");
  await rootPage.waitForTimeout(500);
  assert.equal(await newForm.evaluate(() => document.querySelector("#resume").files.length), 0, "新简历生成前不能上传旧简历");

  watcher.setResumePdfPath(path.resolve("tests/fixtures/jd-detail.html"));
  await rootPage.waitForTimeout(700);
  assert.notEqual(await oldForm.evaluate(() => document.querySelector("#resume").files[0]?.name), "jd-detail.html", "旧表单不得被新简历覆盖");
  assert.equal(await newForm.evaluate(() => document.querySelector("#resume").files[0]?.name), "jd-detail.html");
});

test("findActivePage 优先返回最近交互的页面，无交互时回退主页面", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const main = await context.newPage();
  await main.setContent("<h1>主页面</h1>");
  const other = await context.newPage();
  await other.setContent("<h1>其他页</h1>");
  await main.evaluate(() => { window.__applyLastActiveAt = 1000; });
  await other.evaluate(() => { window.__applyLastActiveAt = 2000; });
  const active = await findActivePage(context, main);
  assert.equal(active, other);
});

test("findActivePage 在无聚焦页时回退主页面", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const main = await context.newPage();
  await main.setContent("<h1>主页面</h1>");
  const active = await findActivePage(context, main);
  assert.equal(active, main);
});

test("autoFill=false 时检测到表单不自动填写，但仍触发表单事件", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-form.html")).href);
  let formEvents = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    autoFill: false,
    pollIntervalMs: 500,
    maxPolls: 3,
    onFieldsChange: () => {},
    onJobDetail: () => {},
    onApplyForm: () => { formEvents++; }
  });
  t.after(() => watcher.stop());
  await page.waitForTimeout(2200);
  assert.equal(await page.inputValue("#name"), "", "autoFill=false 时不应自动填写");
  assert.ok(formEvents >= 1, "仍应检测到表单并触发 onApplyForm");
});

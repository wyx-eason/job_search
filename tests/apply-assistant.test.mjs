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
  loadCompleteFormValues
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
  await page.click("h1");
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
  await page.click("h1");
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
  const jobTab = await context.newPage();
  await jobTab.goto(pathToFileURL(path.resolve("tests/fixtures/jd-detail.html")).href);
  await page.waitForTimeout(500);
  await jobTab.click("h1");
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

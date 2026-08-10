import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { pickKeyword, detectAts, navigateToApply, isJobDetailUrl, hasSingleRole, shouldDeferResume, cleanJobTitleForFileName, looksLikeJobDetailText } from "../lib/ats-navigator.mjs";
import { autofillApplyForm, loadCandidateAutofill } from "../lib/apply-assistant.mjs";

const config = JSON.parse(fs.readFileSync(path.resolve("config/apply.json"), "utf8"));
const require = createRequire(path.resolve(config.playwrightPackage));
const { chromium } = require("playwright");

test("从岗位标题抽取搜索关键词", () => {
  assert.equal(pickKeyword({ title: "自动驾驶算法工程师 北京市" }), "自动驾驶算法工程师");
  assert.equal(pickKeyword({ title: "算法类、研发工程类、产品类、职能支持类等" }), "算法");
  assert.equal(pickKeyword({ title: "人工智能板块、底层核心技术板块、智能出行板块" }), "人工智能");
  assert.equal(hasSingleRole({ title: "算法类、研发工程类、产品类、职能支持类等" }), false);
  assert.equal(hasSingleRole({ title: "自动驾驶算法工程师 北京市" }), true);
});

test("识别招聘系统域名", () => {
  assert.equal(detectAts("https://app.mokahr.com/campus-recruitment/qianli1"), "mokahr");
  assert.equal(detectAts("https://xiaomi.jobs.f.mioffice.cn/s/kJVnd58xtWY"), "feishu");
  assert.equal(detectAts("https://iflytek.zhiye.com/campus/jobs"), "zhiye");
  assert.equal(detectAts("https://job.xpu.edu.cn/detail/job?id=1"), null);
});

test("文件名岗位名清洗：去掉板块名和后续标签", () => {
  assert.equal(cleanJobTitleForFileName("实习经历"), "");
  assert.equal(cleanJobTitleForFileName("【2027秋招】系统评测工程师是否支持外推是否支持外推-"), "系统评测工程师");
  assert.equal(cleanJobTitleForFileName("实施工程师（技术专家方向）-27届-山西"), "实施工程师_技术专家方向_-27届-山西".slice(0, 30));
  assert.equal(cleanJobTitleForFileName("算法类、研发工程类、产品类、职能支持类等"), "");
});

test("公司级汇总行在 ATS 页面上延迟生成简历", () => {
  assert.equal(shouldDeferResume({ title: "算法类、研发工程类、产品类等" }, "https://app.mokahr.com/x#/jobs"), true);
  assert.equal(shouldDeferResume({ title: "自动驾驶算法工程师" }, "https://app.mokahr.com/x#/jobs"), false);
  assert.equal(shouldDeferResume({ title: "算法类、研发工程类等" }, "https://campus.jd.com/api/wx/position/index"), true);
  assert.equal(shouldDeferResume({ title: "技术方向、产品方向、综合方向、物流方向" }, "https://campus.jd.com/api/wx/position/index"), true);
});

test("识别具体岗位详情页 URL", () => {
  assert.equal(isJobDetailUrl("https://app.mokahr.com/campus-recruitment/x#/job/uuid"), true);
  assert.equal(isJobDetailUrl("https://app.mokahr.com/campus-recruitment/x#/jobs"), false);
  assert.equal(isJobDetailUrl("https://xiaomi.jobs.f.mioffice.cn/toptalent/position/123/detail"), true);
});

test("非 ATS 页面含 JD 标记时也能识别为岗位详情", () => {
  assert.equal(looksLikeJobDetailText("职位描述：负责游戏 AI 系统开发。任职要求：熟悉 Python。"), true);
  assert.equal(looksLikeJobDetailText("岗位要求：熟悉 C++、Python，有运动规划经验者优先。"), true);
  assert.equal(looksLikeJobDetailText("工作内容：负责机器人控制算法开发。"), true);
  assert.equal(looksLikeJobDetailText("技术、游戏策划、艺术/设计、人工智能、综合"), false);
});

test("自动导航：搜索岗位→点卡片→点立即投递→表单出现后自动填写", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-nav-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/ats-mokahr.html")).href);
  const job = { title: "自动驾驶算法工程师", company: "千里科技" };
  const nav = await navigateToApply(page, job, { ats: "mokahr" });
  assert.equal(nav.matched, true);
  assert.ok(nav.log.some((l) => /立即投递/.test(l)));
  const result = await autofillApplyForm(page, loadCandidateAutofill());
  assert.equal(await page.inputValue("#name"), "王奕迅");
  assert.equal(await page.inputValue("#phone"), "13800000000");
  assert.ok(result.filled.length >= 2);
});

test("多个匹配岗位时不自动打开，提示手动选择", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-nav-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/ats-mokahr.html")).href);
  const job = { title: "算法工程师", company: "示例公司" };
  const nav = await navigateToApply(page, job, { ats: "mokahr" });
  assert.equal(nav.matched, false);
  assert.match(nav.log.at(-1), /3 个匹配岗位/);
  assert.equal(await page.locator("#detail").isHidden(), true);
});

test("多个匹配时按目标方向偏好自动选择唯一最匹配岗位", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-nav-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/ats-mokahr.html")).href);
  const job = { title: "算法工程师", company: "示例公司" };
  const nav = await navigateToApply(page, job, { ats: "mokahr", preferences: ["规控"] });
  assert.equal(nav.matched, true);
  assert.equal(await page.locator("#jobTitle").textContent(), "机器人规控算法工程师");
});

test("公司级汇总行跳过自动搜索，不填搜索框", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-nav-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/ats-mokahr.html")).href);
  const job = { title: "算法类、研发工程类、产品类、职能支持类等", company: "示例公司" };
  const nav = await navigateToApply(page, job, { ats: "mokahr" });
  assert.equal(nav.matched, false);
  assert.match(nav.log.at(-1), /跳过自动搜索/);
  assert.equal(await page.locator("input").first().inputValue(), "");
});

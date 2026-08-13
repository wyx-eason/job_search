import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { openStore } from "../lib/store.mjs";
import { createDashboardServer } from "../dashboard/server.mjs";

const config = JSON.parse(fs.readFileSync(path.resolve("config/apply.json"), "utf8"));
const require = createRequire(path.resolve(config.playwrightPackage));
const { chromium } = require("playwright");

async function withUiServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-ui-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const raw = JSON.parse(fs.readFileSync(path.resolve("examples/jobs.fixture.json"), "utf8"));
  const jobs = mergeJobs(raw);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const jobId = store.listJobs()[0].id;
  store.close();
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0
  });
  const url = await server.listen();
  t.after(() => server.close());
  return { url, jobId };
}

test("追加“标记已投递”按钮后，“按当前页面生成简历”仍可点击并生成", async (t) => {
  const { url, jobId } = await withUiServer(t);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  let currentResumeHits = 0;
  let refillHits = 0;
  await page.route("**/api/apply", (route) =>
    route.fulfill({
      json: {
        sessionId: jobId,
        deferResume: true,
        packagePath: null,
        files: [],
        qa: null,
        formFieldsPath: "fields.json",
        filled: [],
        skippedSensitive: [],
        skippedUnknown: [],
        note: "手动模式",
        navigation: { log: [] }
      }
    })
  );
  await page.route("**/api/apply/current-resume", (route) => {
    currentResumeHits++;
    return route.fulfill({
      json: { packagePath: "E:\\fake\\pkg", files: ["resume.pdf"], qa: { ok: true, issues: [] }, jobTitle: "具身智能算法应用工程师" }
    });
  });
  await page.route("**/api/apply/refill", (route) => {
    refillHits++;
    return route.fulfill({
      json: { filled: ["姓名=王奕迅"], skippedSensitive: [], skippedUnknown: [], userEdited: 0, note: "" }
    });
  });
  await page.goto(url);
  await page.waitForSelector(`.apply-btn[data-id="${jobId}"]`);
  await page.click(`.apply-btn[data-id="${jobId}"]`);
  await page.waitForSelector("#regenBtn");
  await page.click("#regenBtn");
  await page.waitForFunction(() => document.getElementById("applyStatus").textContent.includes("已按当前页面生成简历"), null, { timeout: 8000 });
  assert.equal(currentResumeHits, 1);
  assert.match(await page.textContent("#applyStatus"), /具身智能算法应用工程师/);
  await page.click("#previewClose");
  await page.click("#refillBtn");
  await page.waitForFunction(() => document.getElementById("applyStatus").textContent.includes("已对当前页面填表"), null, { timeout: 8000 });
  assert.equal(refillHits, 1);
});

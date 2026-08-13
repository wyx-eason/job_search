# 投递助手手动主流程 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把投递流程改为"用户停留在目标 JD 页 → 仪表盘点『按当前页面生成简历』→ 页面点投递 → 点『填表（当前页面）』"，取消自动猜岗、自动重生成、自动填表。

**Architecture:** 复用现有投递会话（持久浏览器 + form watcher），把"猜岗位"改为读取用户当前活动标签页：新增 `findActivePage` 定位聚焦页；新增 `/api/apply/current-resume` 按当前页 JD 生成申请包；`/api/apply/refill` 改为对当前活动页填表；`runApplyAssistant` 增加 `autoNavigate/autoFill` 开关，投递会话以手动模式启动。

**Tech Stack:** Node.js（ESM）、Playwright（持久浏览器）、内置 http 服务、LLM 润色走 DeepSeek responses 接口。

---

## 文件结构

- Modify: `lib/apply-assistant.mjs` — 新增 `findActivePage`；`startFormWatcher` 增加 `autoFill` 选项；`runApplyAssistant` 增加 `autoNavigate/autoFill` 选项并透传。
- Modify: `dashboard/server.mjs` — `/api/apply` 始终延后生成、手动模式启动、去掉自动重生成；新增 `/api/apply/current-resume`；`/api/apply/refill`、`/api/apply/regenerate` 改用当前活动页。
- Modify: `dashboard/index.html` — 按钮与状态文案改为四步引导。
- Test: `tests/apply-assistant.test.mjs`、`tests/dashboard.test.mjs`。

注意：`lib/apply-assistant.mjs`、`dashboard/server.mjs`、`tests/apply-assistant.test.mjs`、`tests/dashboard.test.mjs` 当前含上一轮未提交的岗位选择锁定改动；提交时这些改动会一并纳入，属预期。

运行测试用绝对路径 Node：`C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test tests\<file>.mjs`（在 `E:\job_search\china-campus-ops` 下执行）。

---

### Task 1: 新增 findActivePage（当前活动标签页定位）

执行时修正：`document.hasFocus()` 在 headless 下对所有页面恒为 true，无法区分当前页；且断言失败时 inspect Playwright Page 对象会导致 node:test 挂起。最终实现改为"最近真实用户交互时间戳（`window.__applyLastActiveAt`）"方案：在 `installApplyInteractionTracking` 中监听 pointerdown/keydown/wheel（仅 `isTrusted`）记录时间戳，`findActivePage` 返回时间戳最大的页面，无交互时回退主页面。测试相应改为设置时间戳断言。

**Files:**
- Modify: `lib/apply-assistant.mjs`
- Test: `tests/apply-assistant.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `tests/apply-assistant.test.mjs` 的 import 块加入：

```js
  findActivePage,
```

在文件末尾追加：

```js
test("findActivePage 优先返回聚焦页面，无聚焦页时回退主页面", async (t) => {
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
  await other.evaluate(() => { document.hasFocus = () => true; });
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\apply-assistant.test.mjs`
Expected: FAIL，报 `findActivePage is not exported` 或 undefined。

- [ ] **Step 3: 实现 findActivePage**

在 `lib/apply-assistant.mjs` 的 `getPageInnerText` 函数后新增：

```js
export async function findActivePage(context, fallbackPage = null) {
  const pages = context?.pages?.() || [];
  let best = null;
  let bestAt = 0;
  for (const candidate of pages) {
    if (candidate.isClosed()) continue;
    const at = await candidate.evaluate(() => Number(window.__applyLastActiveAt || 0)).catch(() => 0);
    if (at > 0 && at > bestAt) {
      bestAt = at;
      best = candidate;
    }
  }
  if (best) return best;
  if (fallbackPage && !fallbackPage.isClosed()) return fallbackPage;
  return pages.find((p) => !p.isClosed()) || null;
}
```

并在 `installApplyInteractionTracking` 内新增活动记录（与 `mark` 并列定义、与现有监听器一同注册）：

```js
      const markActivity = (e) => {
        if (e.isTrusted) window.__applyLastActiveAt = Date.now();
      };
      // 在 document.addEventListener("click", markJobSelected, true); 之后追加：
      document.addEventListener("pointerdown", markActivity, true);
      document.addEventListener("keydown", markActivity, true);
      document.addEventListener("wheel", markActivity, true);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\apply-assistant.test.mjs`
Expected: 新增 2 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git -C E:\job_search\china-campus-ops add tests/apply-assistant.test.mjs lib/apply-assistant.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: 新增 findActivePage 定位当前活动标签页"
```

---

### Task 2: startFormWatcher 增加 autoFill 选项

**Files:**
- Modify: `lib/apply-assistant.mjs`
- Test: `tests/apply-assistant.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `tests/apply-assistant.test.mjs` 文件末尾追加：

```js
test("autoFill=false 时检测到表单不自动填写，但仍触发表单事件", async (t) => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve("tests/fixtures/apply-late.html")).href);
  let formEvents = 0;
  const watcher = startFormWatcher({
    page,
    candidate: loadCandidateAutofill(),
    autoFill: false,
    pollIntervalMs: 1000,
    maxPolls: 4,
    onFieldsChange: () => {},
    onJobDetail: () => {},
    onApplyForm: () => { formEvents++; }
  });
  t.after(() => watcher.stop());
  await page.waitForTimeout(4500);
  assert.equal(await page.inputValue("#name"), "", "autoFill=false 时不应自动填写");
  assert.ok(formEvents >= 1, "仍应检测到表单并触发 onApplyForm");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\apply-assistant.test.mjs`
Expected: FAIL，`#name` 被自动填写（当前实现忽略 autoFill）。

- [ ] **Step 3: 实现 autoFill 选项**

修改 `lib/apply-assistant.mjs` 中 `startFormWatcher` 的函数签名：

```js
export function startFormWatcher({ page, candidate, resumePdfPath, formValues = {}, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, pollIntervalMs = 3000, maxPolls = null, jobMap = null, autoFill = true }) {
```

把轮询循环内的自动填写段（`if (!formPage) return;` 到 `onFieldsChange?.(...)`）替换为：

```js
      if (!formPage) return;
      const fillRevision = selectionRevision;
      const result = autoFill
        ? await autofillApplyForm(formPage, candidate, {
            resumePdfPath: currentResumePdfPath,
            formValues,
            isUploadCurrent: () => fillRevision === selectionRevision
          })
        : { filled: [], skippedSensitive: [], skippedUnknown: [], formFields: await captureFormFields(formPage) };
      if (fillRevision !== selectionRevision) return;
      if (looksLikeApplyForm(result.formFields || [])) onApplyForm?.({ revision: fillRevision, fields: result.formFields || [], page: formPage });
      const fieldsJson = JSON.stringify(result.formFields || []);
      if (fieldsJson !== lastFieldsJson) {
        lastFieldsJson = fieldsJson;
        onFieldsChange?.(result.formFields || [], result);
      }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\apply-assistant.test.mjs`
Expected: 新增用例 PASS；原有 `持续监听器在表单延迟出现后自动填写` 等默认 autoFill=true 用例仍 PASS。

- [ ] **Step 5: 提交**

```bash
git -C E:\job_search\china-campus-ops add tests/apply-assistant.test.mjs lib/apply-assistant.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: startFormWatcher 支持 autoFill=false 手动模式"
```

---

### Task 3: runApplyAssistant 增加 autoNavigate / autoFill 选项

**Files:**
- Modify: `lib/apply-assistant.mjs`

- [ ] **Step 1: 修改函数签名**

`lib/apply-assistant.mjs` 中 `runApplyAssistant` 签名改为：

```js
export async function runApplyAssistant({ applyUrl, config, job = {}, headless = false, maxWaitMs = 30000, resumePdfPath = null, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, autoNavigate = true, autoFill = true }) {
```

- [ ] **Step 2: 条件跳过自动导航**

把 `runApplyAssistant` 内的：

```js
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const navigation = await navigateToApply(page, job);
```

替换为：

```js
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const navigation = autoNavigate
    ? await navigateToApply(page, job)
    : { matched: false, log: ["手动模式：已打开投递链接，请在浏览器中自行搜索并打开目标岗位 JD 页"] };
```

- [ ] **Step 3: 透传 autoFill 并跳过初始自动填表**

把 `runApplyAssistant` 内的：

```js
  const watcher = startFormWatcher({ page, candidate, resumePdfPath, formValues, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, jobMap });
  await watcher.ready;
  const result = await waitAndAutofill(page, candidate, maxWaitMs, { resumePdfPath, formValues });
  result.submitted = false;
  result.navigation = navigation;
```

替换为：

```js
  const watcher = startFormWatcher({ page, candidate, resumePdfPath, formValues, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, jobMap, autoFill });
  await watcher.ready;
  const result = autoFill
    ? await waitAndAutofill(page, candidate, maxWaitMs, { resumePdfPath, formValues })
    : {
        formFields: [],
        filled: [],
        skippedSensitive: [],
        skippedUnknown: [],
        userEdited: 0,
        submitted: false,
        note: "手动模式：请在浏览器中打开目标岗位 JD 页，然后点“按当前页面生成简历”；在页面点投递后，再点“填表（当前页面）”。"
      };
  result.submitted = false;
  result.navigation = navigation;
```

- [ ] **Step 4: 运行相关测试确认无回归**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\apply-assistant.test.mjs tests\llm-polish.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git -C E:\job_search\china-campus-ops add lib/apply-assistant.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: runApplyAssistant 支持 autoNavigate/autoFill 手动模式"
```

---

### Task 4: /api/apply 改为手动模式启动

**Files:**
- Modify: `dashboard/server.mjs`
- Test: `tests/dashboard.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `tests/dashboard.test.mjs` 中新增（参考现有 `apply 接口成功时返回完整响应` 的搭建方式）：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增用例 FAIL（captured 为 null 或 autoNavigate 未定义）。

- [ ] **Step 3: 修改 /api/apply 处理器**

在 `dashboard/server.mjs` 的 `/api/apply` 处理块中：

1) 把：
```js
        const deferResume = shouldDeferResume(job, applyUrl);
```
替换为：
```js
        const deferResume = true;
```

2) 把预生成块：
```js
          let pkg = null;
          let resumePdfPath = null;
          if (!deferResume) {
            pkg = await createApplicationPackage(job, {}, undefined, { enrichJd: enrichJobJdWithBrowser });
            resumePdfPath = prepareUploadResume(pkg.packagePath, job.company, job.title);
          }
```
替换为：
```js
          let pkg = null;
          let resumePdfPath = null;
```

3) 在 `applyAssistant({` 调用中增加两行（放在 `headless: false,` 之后）：
```js
            autoNavigate: false,
            autoFill: false,
```

4) 把 `onJobDetail` 回调末尾的自动重生成调用：
```js
                regenerateForCurrentJob(session, { auto: true }).catch((error) => {
                  session.lastAutoAttempt = { at: new Date().toISOString(), ok: false, reason: `生成失败：${error.message}` };
                  console.error(`[投递会话] 自动重生成异常：${error.message}`);
                });
```
替换为注释（保留状态记录，不自动重生成）：
```js
                // 手动模式：不自动重生成，等待用户点击“按当前页面生成简历”
```

- [ ] **Step 4: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增用例 PASS；原有 apply/反馈/重填表/重生成相关用例仍 PASS。

- [ ] **Step 5: 提交**

```bash
git -C E:\job_search\china-campus-ops add tests/dashboard.test.mjs dashboard/server.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: /api/apply 改为手动模式（不自动导航/填表/预生成/重生成）"
```

---

### Task 5: 新增 /api/apply/current-resume（按当前页面生成简历）

**Files:**
- Modify: `dashboard/server.mjs`
- Test: `tests/dashboard.test.mjs`

- [ ] **Step 1: 可注入依赖与助手函数**

在 `dashboard/server.mjs` 的 import 中把 `runApplyAssistant` 行的 apply-assistant 导入追加 `findActivePage`：

```js
import { runApplyAssistant, autofillApplyForm, loadCandidateAutofill, uploadResumeToForm, prepareUploadResume, showBanner, loadCompleteFormValues, getPageInnerText, findActivePage } from "../lib/apply-assistant.mjs";
```

把 `createDashboardServer` 签名改为：

```js
export function createDashboardServer(options = {}) {
  const { dbPath, preferencesPath, sourcesPath, host = "127.0.0.1", port = 8787, applyAssistant = runApplyAssistant, locateActivePage = findActivePage, readPageText = getPageInnerText, generatePackage = generateApplicationPackage } = options;
```

在 `regenerateForCurrentJob` 函数定义之后新增：

```js
  async function generateResumeFromCurrentPage(session) {
    const activePage = await locateActivePage(session.context, session.page);
    if (!activePage || activePage.isClosed()) throw new Error("没有可用的浏览器页面，请重新点击“去投递”");
    const text = await readPageText(activePage);
    if (!isJobDetailPageText(text)) {
      return { error: "当前页面不是具体岗位 JD 页，请先在浏览器里打开目标岗位的职位详情页（页面需含岗位职责/任职要求等内容）" };
    }
    const jobTitle = extractJobTitleFromPageText(text) || session.job?.title_raw || session.job?.title || "";
    const jdText = extractJdFromPageText(text) || session.lastJdText || session.job?.jd_text || "";
    if (!jdText) return { error: "未能从当前页面提取到 JD 内容" };
    const job = {
      ...(session.job || {}),
      company_raw: session.job?.company_raw || session.job?.company || "",
      title_raw: jobTitle || session.job?.title_raw || "岗位",
      jd_text: jdText
    };
    const pkg = await generatePackage({ job, root, userFeedback: session.feedback || "" });
    const uploadPdf = prepareUploadResume(pkg.packagePath, job.company_raw, job.title_raw);
    session.resumePdfPath = uploadPdf;
    session.watcher?.setResumePdfPath?.(uploadPdf);
    session.lastRegen = {
      at: new Date().toISOString(),
      url: activePage.url(),
      jdText,
      packagePath: pkg.packagePath,
      qa: pkg.qa,
      polish: pkg.polish || null,
      uploaded: false,
      uploadedFileName: path.basename(uploadPdf),
      feedback: session.feedback || ""
    };
    session.lastJdText = jdText;
    session.lastJobTitle = jobTitle;
    return {
      packagePath: pkg.packagePath,
      files: pkg.files,
      qa: pkg.qa,
      polish: pkg.polish || null,
      uploadedFileName: path.basename(uploadPdf),
      jobTitle,
      jdLen: jdText.length,
      url: activePage.url()
    };
  }
```

- [ ] **Step 2: 写失败测试**

在 `tests/dashboard.test.mjs` 中新增：

```js
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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增用例 FAIL（404 或 `generateResumeFromCurrentPage is not defined` / endpoint 404）。

- [ ] **Step 4: 实现端点**

在 `dashboard/server.mjs` 的 `/api/apply/refill` 分支之前新增：

```js
      if (req.method === "POST" && req.url === "/api/apply/current-resume") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { sessionId, jobId } = JSON.parse(body || "{}");
        const session = applySessions.get(sessionId || jobId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有打开的投递会话，请重新点击去投递" }));
          return;
        }
        const out = await generateResumeFromCurrentPage(session);
        if (out?.error) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: out.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
        return;
      }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增 3 个用例 PASS。

- [ ] **Step 6: 提交**

```bash
git -C E:\job_search\china-campus-ops add tests/dashboard.test.mjs dashboard/server.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: 新增按当前页面生成简历端点 /api/apply/current-resume"
```

---

### Task 6: /api/apply/refill 改为对当前活动页填表

**Files:**
- Modify: `dashboard/server.mjs`
- Test: `tests/dashboard.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `tests/dashboard.test.mjs` 中新增：

```js
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
  const fakeAssistant = {
    result: { formFields: [], filled: [], skippedSensitive: [], skippedUnknown: [], note: "手动模式", navigation: { matched: false, log: [] } },
    page: formPage,
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
```

注意：该测试需要引入 `chromium` 与 `config`，在 `tests/dashboard.test.mjs` 顶部参照 `tests/apply-assistant.test.mjs` 增加：

```js
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const config = JSON.parse(fs.readFileSync(path.resolve("config/apply.json"), "utf8"));
const require = createRequire(path.resolve(config.playwrightPackage));
const { chromium } = require("playwright");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增用例 FAIL（当前实现填 `session.formPage || session.selectedDetailPage || session.page`，且未用 locateActivePage）。

- [ ] **Step 3: 修改 /api/apply/refill 处理器**

把：

```js
        const result = await autofillApplyForm(session.formPage || session.selectedDetailPage || session.page, loadCandidateAutofill(), { resumePdfPath: session.resumePdfPath, formValues: loadCompleteFormValues() });
```

替换为：

```js
        const target = await locateActivePage(session.context, session.formPage || session.selectedDetailPage || session.page);
        if (!target || target.isClosed()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有可用的浏览器页面，请重新点击去投递" }));
          return;
        }
        const result = await autofillApplyForm(target, loadCandidateAutofill(), { resumePdfPath: session.resumePdfPath, formValues: loadCompleteFormValues() });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: 新增用例 PASS；原 `重新填表接口：无会话时返回 404` 仍 PASS。

- [ ] **Step 5: 提交**

```bash
git -C E:\job_search\china-campus-ops add tests/dashboard.test.mjs dashboard/server.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: /api/apply/refill 改为对当前活动页填表"
```

---

### Task 7: /api/apply/regenerate 复用当前页逻辑

**Files:**
- Modify: `dashboard/server.mjs`

- [ ] **Step 1: 修改 regenerate 处理器**

把 `/api/apply/regenerate` 分支中的：

```js
        const regen = await regenerateForCurrentJob(session);
        if (!regen || regen.skipped) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: regen?.skipped || "未能从当前页面提取岗位 JD，请先打开具体岗位页面" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(regen));
        return;
```

替换为：

```js
        const out = await generateResumeFromCurrentPage(session);
        if (out?.error) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: out.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
        return;
```

- [ ] **Step 2: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\dashboard.test.mjs`
Expected: `按岗位重新生成简历接口：无会话时返回 404` 仍 PASS；反馈接口测试仍 PASS。

- [ ] **Step 3: 提交**

```bash
git -C E:\job_search\china-campus-ops add dashboard/server.mjs
git -C E:\job_search\china-campus-ops commit -m "feat: /api/apply/regenerate 复用按当前页面生成简历逻辑"
```

---

### Task 8: 仪表盘前端改为四步引导

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: 修改会话建立后的状态文案**

把 `bindApplyButtons` 内 `status.textContent = ...已打开投递页...` 整条模板字符串替换为：

```js
          status.textContent = `已打开投递页（浏览器），投递会话已建立。请按顺序操作：① 在浏览器里登录并打开你想投的具体岗位 JD 页；② 回到本页点“按当前页面生成简历”；③ 在浏览器里点投递进入申请表单；④ 回到本页点“填表（当前页面）”自动填写。${navLog ? "导航：" + navLog + "。" : ""}${data.note || ""}助手不会点提交。`;
```

- [ ] **Step 2: 修改动作区按钮**

把：

```js
          const actions = document.getElementById("applyActions");
          actions.innerHTML = `${data.packagePath ? `<button class="apply-btn" id="previewResumeBtn">预览简历</button><button class="apply-btn" id="openPackageBtn">打开申请包目录</button>` : ""}<button class="apply-btn" id="refillBtn">重新填表</button>`;
```

替换为：

```js
          const actions = document.getElementById("applyActions");
          actions.innerHTML = `${data.packagePath ? `<button class="apply-btn" id="previewResumeBtn">预览简历</button><button class="apply-btn" id="openPackageBtn">打开申请包目录</button>` : ""}<button class="apply-btn" id="regenBtn">按当前页面生成简历</button><button class="apply-btn" id="refillBtn">填表（当前页面）</button>`;
```

- [ ] **Step 3: 调整 refill 按钮文案与提示**

把 refill 点击回调里的：

```js
            if (!res.ok) { status.textContent = "重新填表失败：" + (refill.error || res.status); return; }
            status.textContent = `已重新填表：自动填写 ${refill.filled.length} 项；${refill.userEdited ? `你手动改过的 ${refill.userEdited} 个字段未动；` : ""}敏感字段 ${refill.skippedSensitive.length} 项待确认；未知字段 ${refill.skippedUnknown.length} 项（如：${refill.skippedUnknown.slice(0, 3).join("、")}）。${refill.note || ""}`;
```

替换为：

```js
            if (!res.ok) { status.textContent = "填表失败：" + (refill.error || res.status); return; }
            status.textContent = `已对当前页面填表：自动填写 ${refill.filled.length} 项；${refill.userEdited ? `你手动改过的 ${refill.userEdited} 个字段未动；` : ""}敏感字段 ${refill.skippedSensitive.length} 项待确认；未知字段 ${refill.skippedUnknown.length} 项（如：${refill.skippedUnknown.slice(0, 3).join("、")}）。${refill.uploadedResume ? `已上传简历（${refill.uploadedResume}）。` : (refill.resumeUploadSkipped || "未上传简历（请先按当前页面生成简历）。")}`;
```

- [ ] **Step 4: regen 按钮改为按当前页面生成并预览（整块替换）**

把原"追加 regenBtn 并绑定 regenerate"的整块代码：

```js
          actions.innerHTML += ` <button class="apply-btn" id="regenBtn">按当前岗位重新生成简历</button>`;
          document.getElementById("regenBtn").addEventListener("click", async () => {
            const res = await fetch("/api/apply/regenerate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: data.sessionId })
            });
            const regen = await readJson(res);
            if (!res.ok) { status.textContent = "重新生成：" + (regen.error || res.status); return; }
            status.textContent = `已按当前岗位重新生成简历：${regen.packagePath}（QA ${regen.qa?.ok ? "通过" : "有问题：" + (regen.qa?.issues || []).join("、")}）。${regen.uploaded ? `已重新上传（${regen.uploadedFileName}）。` : "未找到上传入口，请手动上传。"}`;
            showPreview(regen.packagePath);
          });
```

替换为（按钮已在 Task 8 Step 2 的初始 `actions.innerHTML` 中，这里只绑定事件，不再 `+=` 追加，避免重复 id）：

```js
          document.getElementById("regenBtn").addEventListener("click", async () => {
            status.textContent = "正在按当前页面生成简历…（LLM 润色约 10-60 秒，请稍候）";
            const res = await fetch("/api/apply/current-resume", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: data.sessionId })
            });
            const regen = await readJson(res);
            if (!res.ok) { status.textContent = "生成失败：" + (regen.error || res.status); return; }
            status.textContent = `已按当前页面生成简历：${regen.packagePath}（QA ${regen.qa?.ok ? "通过" : "有问题：" + (regen.qa?.issues || []).join("、")}）。${regen.uploadedFileName ? `可用于填表上传（${regen.uploadedFileName}）。` : ""}`;
            showPreview(regen.packagePath);
          });
```

- [ ] **Step 5: 简化状态轮询（去掉自动重生成提示）**

把 `window.__applyPoll` 回调里与 `lastAutoAttempt`、`lastRegen` 自动提示相关的两段 if 删除，仅保留：

```js
          window.__applyPoll = setInterval(async () => {
            const r = await fetch(`/api/apply/status?jobId=${encodeURIComponent(data.sessionId)}`);
            if (!r.ok) return;
            const s = await readJson(r);
            if (s.regenInProgress) {
              status.textContent = "正在按当前页面生成简历…（LLM 润色约 10-60 秒，请稍候）";
            }
          }, 4000);
```

- [ ] **Step 6: 验证页面语法并提交**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' -e "const fs=require('fs');const h=fs.readFileSync('dashboard/index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('HTML script OK')"`
Expected: `HTML script OK`。

```bash
git -C E:\job_search\china-campus-ops add dashboard/index.html
git -C E:\job_search\china-campus-ops commit -m "feat: 仪表盘投递流程改为四步手动引导"
```

---

### Task 9: 全量回归与收尾

**Files:**
- None（仅验证）

- [ ] **Step 1: 运行全量测试**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test`
Expected: 通过数 ≥ 150（原 147 + 新增）；已知 3 个投递时序类用例（`等待表单期间岗位切换后不上传启动时的旧简历`、`跨页面投递事件倒序到达时仍锁定浏览器中最后点击的岗位`、`apply 助手返回前发生的岗位事件会在会话建立后重放`）可能因环境时序失败，属既有问题，与本次改动无关。

- [ ] **Step 2: 校验依赖导入无残留**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check dashboard/server.mjs`
Expected: 无输出（语法通过）。若 `shouldDeferResume` / `createApplicationPackage` / `enrichJobJdWithBrowser` 已不再使用，从 import 中移除。

- [ ] **Step 3: 人工冒烟（用户侧）**

双击 `start-dashboard.cmd` 启动仪表盘 → 打开某公司"去投递" → 浏览器中打开目标岗位 JD 页 → 点"按当前页面生成简历"（出现预览）→ 页面点投递 → 点"填表（当前页面）"（姓名/手机等被填、简历上传）。

- [ ] **Step 4: 提交收尾（如有 lint/清理改动）**

```bash
git -C E:\job_search\china-campus-ops add dashboard/server.mjs
git -C E:\job_search\china-campus-ops commit -m "chore: 清理手动模式后的无用导入"
```

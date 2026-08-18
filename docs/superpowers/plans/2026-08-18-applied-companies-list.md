# 投递周报：已投递公司列表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仪表盘“投递周报”中新增默认折叠的已投递公司列表，只展示当前活跃投递并按投递时间倒序排列。

**Architecture:** 后端在 `/api/dashboard` 的 `weekly` 对象中新增 `appliedJobs` 数组；前端在“投递周报”区块内渲染子折叠列表。数据来自现有 `applications` 表和 `jobs` 表，不新增数据库表。

**Tech Stack:** Node.js ES modules、内置 node:sqlite、原生 HTML/CSS/JS 仪表盘、node:test。

---

### Task 1: 后端返回活跃已投递列表

**Files:**
- Modify: `dashboard/api.mjs`
- Test: `tests/dashboard.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `tests/dashboard.test.mjs` 中新增两个测试：

```js
test("仪表盘接口返回活跃已投递列表且终态不显示", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-applied-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  store.upsertJobs(fixture());
  const rows = store.listJobs({});
  const ai = rows.find((r) => r.company === "示例 AI 公司");
  const ctrl = rows.find((r) => r.company === "临汾示例制造企业");
  const intern = rows.find((r) => r.company === "示例公司");
  store.updateJobStatus(ai.id, "interview");
  store.updateJobStatus(ctrl.id, "applied");
  store.updateJobStatus(intern.id, "rejected");
  store.db.prepare("INSERT INTO applications (job_id, package_path, status, applied_at) VALUES (?,?,?,?)").run(ai.id, "pkg-a", "interview", "2026-08-10T00:00:00.000Z");
  store.db.prepare("INSERT INTO applications (job_id, package_path, status, applied_at) VALUES (?,?,?,?)").run(ctrl.id, "pkg-b", "applied", "2026-08-12T00:00:00.000Z");
  store.db.prepare("INSERT INTO applications (job_id, package_path, status, applied_at) VALUES (?,?,?,?)").run(intern.id, "pkg-c", "rejected", "2026-08-13T00:00:00.000Z");
  store.close();
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0
  });
  const url = await server.listen();
  t.after(() => server.close());
  const data = await (await fetch(`${url}/api/dashboard`)).json();
  assert.deepEqual(data.weekly.appliedJobs.map((j) => j.jobId), [ctrl.id, ai.id]);
  assert.equal(data.weekly.appliedJobs[0].company, "临汾示例制造企业");
  assert.equal(data.weekly.appliedJobs[0].statusLabel, "已投递");
  assert.equal(data.weekly.appliedJobs[1].statusLabel, "面试中");
  assert.equal(data.weekly.appliedJobs.some((j) => j.jobId === intern.id), false);
});

test("仪表盘接口无投递时 appliedJobs 为空数组", async (t) => {
  const url = await withServer(t);
  const data = await (await fetch(`${url}/api/dashboard`)).json();
  assert.deepEqual(data.weekly.appliedJobs, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="已投递列表" tests/dashboard.test.mjs`
Expected: 失败，`data.weekly.appliedJobs` 为 `undefined`。

- [ ] **Step 3: 实现后端字段**

在 `dashboard/api.mjs` 顶部新增导入：

```js
import { statusLabel } from "../lib/application-tracker.mjs";
```

在 `RESPONDED_STATUSES` 下方新增常量：

```js
const ACTIVE_APPLIED_STATUSES = ["applied", "assessment", "interview", "offer"];
```

在 `loadDashboardData` 中，`const appliedJobs = rows.filter((r) => appliedAt.has(r.id));` 之后新增：

```js
const activeAppliedList = appliedJobs
  .filter((r) => ACTIVE_APPLIED_STATUSES.includes(r.status))
  .map((r) => ({
    jobId: r.id,
    company: r.company,
    title: r.title,
    city: r.city || r.location || null,
    status: r.status,
    statusLabel: statusLabel(r.status),
    appliedAt: appliedAt.get(r.id)
  }))
  .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
```

在 `weekly` 对象中新增：

```js
appliedJobs: activeAppliedList,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --test-name-pattern="已投递列表" tests/dashboard.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add dashboard/api.mjs tests/dashboard.test.mjs
git commit -m "feat: 仪表盘接口返回活跃已投递列表"
```

### Task 2: 前端渲染默认折叠的已投递公司列表

**Files:**
- Modify: `dashboard/index.html`
- Test: `tests/dashboard-ui.test.mjs`

- [ ] **Step 1: 写失败 UI 测试**

在 `tests/dashboard-ui.test.mjs` 中新增测试：

```js
test("投递周报显示已投递公司列表且默认折叠", async (t) => {
  const { url, jobId } = await withUiServer(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-ui-applied-"));
  const dbPath = path.join(dir, "jobs.db");
  const store = openStore(dbPath);
  const raw = JSON.parse(fs.readFileSync(path.resolve("examples/jobs.fixture.json"), "utf8"));
  const jobs = mergeJobs(raw);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  const row = store.listJobs({}).find((r) => r.id === jobId);
  store.updateJobStatus(row.id, "interview");
  store.db.prepare("INSERT INTO applications (job_id, package_path, status, applied_at) VALUES (?,?,?,?)").run(row.id, "pkg", "interview", "2026-08-10T00:00:00.000Z");
  store.close();
  const server = createDashboardServer({
    dbPath,
    preferencesPath: path.resolve("candidate/preferences.json"),
    sourcesPath: path.resolve("config/sources.json"),
    port: 0
  });
  const uiUrl = await server.listen();
  t.after(() => server.close());
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-applied-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: config.browserExecutable,
    headless: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(uiUrl);
  await page.waitForSelector("#appliedJobsWrap");
  await page.waitForFunction(() => document.getElementById("appliedJobsCount")?.textContent.includes("1"), null, { timeout: 8000 });
  assert.equal(await page.isVisible("#appliedJobs"), false);
  await page.click("#appliedJobsWrap .sec-head");
  assert.equal(await page.isVisible("#appliedJobs"), true);
  assert.match(await page.textContent("#appliedJobs"), /示例 AI 公司/);
});
```

注意：`withUiServer` 已返回 `jobId`，测试里需要另外建一个带投递记录的 DB，因为原 helper 不写 `applications`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="投递周报显示已投递公司列表" tests/dashboard-ui.test.mjs`
Expected: 失败，`#appliedJobsWrap` 不存在。

- [ ] **Step 3: 添加 CSS 与 HTML**

在 `dashboard/index.html` 的 `<style>` 中新增：

```css
.sub-collapsible { margin-top: 12px; border-top: 1px dashed #e5e7eb; padding-top: 8px; }
.sub-collapsible .sec-head { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; font-size: 14px; margin: 0 0 6px; }
.status-badge { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1px 8px; font-size: 12px; color: #4b5563; white-space: nowrap; }
```

在“投递周报”区块的 `sec-body` 内、`weeklyStats` 之后新增：

```html
<div class="sub-collapsible" id="appliedJobsWrap" hidden>
  <h3 class="sec-head"><span class="arrow">▸</span>已投递公司 <span id="appliedJobsCount" class="muted"></span></h3>
  <div class="sec-body" id="appliedJobs"></div>
</div>
```

- [ ] **Step 4: 修改折叠初始化与默认值**

在 `DEFAULT_COLLAPSED` 中新增：

```js
applied_jobs: true,
```

把 `initCollapse` 的选择器从：

```js
document.querySelectorAll(".collapsible")
```

改为：

```js
document.querySelectorAll(".collapsible, .sub-collapsible")
```

- [ ] **Step 5: 渲染列表**

在 `main()` 中 `weeklyStats` 渲染完成后新增：

```js
const appliedWrap = document.getElementById("appliedJobsWrap");
const appliedList = data.weekly.appliedJobs || [];
if (!appliedList.length) {
  appliedWrap.hidden = true;
} else {
  appliedWrap.hidden = false;
  document.getElementById("appliedJobsCount").textContent = `（${appliedList.length}）`;
  document.getElementById("appliedJobs").innerHTML = appliedList
    .map((a) => `<li><span>${esc(a.company)} · ${esc(a.title)} · ${esc(a.city || "地点未知")} · ${new Date(a.appliedAt).toLocaleDateString("zh-CN")}</span><span class="status-badge">${esc(a.statusLabel)}</span></li>`)
    .join("");
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test --test-name-pattern="投递周报显示已投递公司列表" tests/dashboard-ui.test.mjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add dashboard/index.html tests/dashboard-ui.test.mjs
git commit -m "feat: 投递周报显示默认折叠的已投递公司列表"
```

### Task 3: 回归验证

**Files:**
- Test: `tests/dashboard.test.mjs`
- Test: `tests/dashboard-ui.test.mjs`

- [ ] **Step 1: 运行相关测试**

Run: `node --test --test-concurrency=1 tests/dashboard.test.mjs tests/dashboard-ui.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 2: 提交验证记录（如有）**

如项目 `docs/verification-record.md` 需要更新，追加本次命令、日期和结果后提交。

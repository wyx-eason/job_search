# Apply Selection Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让多标签页投递流程始终使用用户最后点击投递的具体岗位生成简历，并在延迟出现的表单中自动填写和上传最新简历。

**Architecture:** 在 `apply-assistant` 中记录真实用户的岗位与投递点击，并按页面维护详情指纹；在 `dashboard` 中分离详情来源页和表单目标页。监听器持有可更新的简历路径，生成完成后由会话更新。

**Tech Stack:** Node.js ES modules、Playwright、Node test runner

---

### Task 1: 锁定最后投递的岗位详情

**Files:**
- Modify: `lib/apply-assistant.mjs`
- Test: `tests/apply-assistant.test.mjs`
- Create: `tests/fixtures/apply-job-list.html`

- [x] 添加失败测试：列表页、旧详情和新详情同时存在时，点击新详情的投递按钮只产生新详情的锁定事件。
- [x] 运行 `node --test --test-name-pattern="最后点击投递" tests/apply-assistant.test.mjs`，确认测试因列表页/旧详情覆盖而失败。
- [x] 按页面保存详情指纹，并记录真实岗位卡片和投递按钮点击；让投递点击在跳转前锁定详情快照。
- [x] 重跑针对性测试，确认通过。

### Task 2: 延迟表单使用最新简历自动填写

**Files:**
- Modify: `lib/apply-assistant.mjs`
- Modify: `dashboard/server.mjs`
- Test: `tests/apply-assistant.test.mjs`

- [x] 添加失败测试：监听器以空简历启动，更新路径后出现的新表单应自动填写文本并上传该文件。
- [x] 运行 `node --test --test-name-pattern="更新后的简历" tests/apply-assistant.test.mjs`，确认测试因静态路径而失败。
- [x] 给监听器增加 `setResumePdfPath`，并在轮询填表时带上完整字段配置。
- [x] 在生成完成后更新监听器简历路径；会话分别保存详情页与表单页，生成读取详情快照、上传指向表单页。
- [x] 重跑针对性测试，确认通过。

### Task 3: 回归验证

**Files:**
- Modify: `docs/verification-record.md`

- [x] 运行 `node --test tests/apply-assistant.test.mjs tests/dashboard.test.mjs tests/regen-guard.test.mjs`。
- [x] 运行 `pnpm test`（当前环境无全局 `npm`，脚本内容等同于 `npm test`）。
- [x] 在 `docs/verification-record.md` 记录命令、日期和结果。

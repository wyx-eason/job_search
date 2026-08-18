# 验证记录

## 环境

- 工作区：`E:\job_search\china-campus-ops`
- Node：`C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- Node SQLite：可用，使用 `node:sqlite`。

## 已执行验证

- `node --test tests/smoke.test.mjs`：通过。
- `node --test tests/validate-candidate.test.mjs`：3 项通过。
- `node --test tests/job-contract.test.mjs`：4 项通过。
- `node --test tests/ranking.test.mjs`：2 项通过。
- `node --test tests/store.test.mjs`：1 项通过。
- `node --test tests/import-profile.test.mjs`：1 项通过。
- `node --test tests/daily-scan.test.mjs`：1 项通过。
- `node --test tests/application-boundary.test.mjs`：2 项通过。
- 使用 `examples/jobs.fixture.json` 执行每日扫描：写入 3 条岗位，生成中文日报。

## 已知限制

- PowerShell 默认输出编码可能显示中文乱码，文件本身按 UTF-8 写入。
- 原始简历导入是保守提取，所有事实先为 `unverified`，需要用户逐项确认。
- 真实招聘网站来源和 Chrome 表单交互尚未在 MVP 中接入。
- 最终提交按钮没有自动化路径。

## 2026-08-12 小鹏多级投递流程修复

- `node --test --test-name-pattern="只锁定最后点击投递" tests/apply-assistant.test.mjs`：先失败（没有投递锁定事件），实现后 1 项通过。
- `node --test --test-name-pattern="更新后的简历路径" tests/apply-assistant.test.mjs`：先失败（`setResumePdfPath` 不存在），实现后 1 项通过。
- `node --test tests/apply-assistant.test.mjs tests/dashboard.test.mjs tests/regen-guard.test.mjs`：53 项通过，0 项失败。
- `pnpm test`（执行 `node --test tests/*.test.mjs`）：147 项通过，0 项失败。
- 追加覆盖同一轮连续点击两个详情页时严格锁定最后一次投递，以及切岗后旧表单不接收新岗位简历。
- `git diff --check`：通过。

## 2026-08-18 投递周报已投递公司列表

- `node --test --test-name-pattern="已投递列表|appliedJobs" tests/dashboard.test.mjs`：2 项通过。
- `node --test --test-name-pattern="投递周报显示已投递公司列表" tests/dashboard-ui.test.mjs`：1 项通过。
- `node --test --test-concurrency=1 tests/dashboard.test.mjs tests/dashboard-ui.test.mjs`：27 项通过，0 项失败。
- 后端 `weekly.appliedJobs` 只包含活跃投递（applied / assessment / interview / offer），终态不显示，按投递时间倒序。
- 前端“投递周报”新增默认折叠的“已投递公司（N）”列表，展开后显示公司、岗位、投递日期和状态徽标。

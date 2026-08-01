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

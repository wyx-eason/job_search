# 国内校招求职 MVP

这是面向王奕迅的 2027 届国内校招求职扩展，复用 `career-ops` 处理岗位评估、中文简历、投递跟踪和学习分析。

当前版本已经具备：

- 2027 届正式校招与提前批资格判定。
- 临汾周边、西安和大城市练手三个岗位池。
- 跨来源职位编号去重和 SQLite 持久化。
- 从 `../profile/` 两份 LaTeX 简历生成未确认事实草稿。
- 中文每日摘要和来源异常报告。
- 申请包生成与 Chrome 预填安全边界。

## 运行环境

需要 Node.js 20。当前 Codex 工作区可使用捆绑 Node，系统命令行未必有 `node` PATH；可以使用 Node 的绝对路径执行脚本。

## 常用命令

```powershell
node --test tests/*.test.mjs
node scripts/import-profile.mjs
node scripts/daily-scan.mjs examples/jobs.fixture.json
node scripts/print-schedule-command.mjs
```

原始简历位于项目外的 `../profile/`，导入脚本只读它们，并将所有提取内容标为 `unverified`。

日报写入 `reports/daily/YYYY-MM-DD.md`，运行数据库写入 `data/jobs.db`。个人数据、申请包、浏览器配置和报告默认不进入 Git。

## 投递边界

系统可以生成岗位定制包、打开申请页、填写安全字段和上传简历，但永远不会点击最终提交。敏感字段必须逐项确认，验证码和密码不保存。

## 已知限制

当前 MVP 使用样例 JSON 验证核心链路。企业官网、国聘、牛客、高校就业网及登录型平台适配器将在后续阶段逐个增加；登录平台需要 Chrome 交互，不能假装无人值守覆盖全部岗位。

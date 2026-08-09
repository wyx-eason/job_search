# 定制申请包生成设计（简历 + 匹配报告 + 表单答案 + 溯源）

**日期：** 2026-08-03

**目标：** 选定岗位后一键生成完整申请包：一页中文 HTML/PDF 简历、匹配报告（覆盖与真实缺口）、表单答案、生成溯源审计，并接入仪表盘"去投递"流程。

## 输入

- 岗位 `job`：来自 SQLite（公司、岗位、JD、投递链接）。
- `candidate/facts.yml`：候选人事实条目（教育、实习、项目、技能、荣誉；当前全部 `unverified`）。
- `candidate/skills.yml`：技能等级（当前为空）。
- `candidate/autofill.yml` + `facts.yml`：安全表单字段（姓名、电话、邮箱、学校、学历、专业、毕业时间）。
- 可选 `--verified-only`：严格模式，只使用 `status !== "unverified"` 的事实。

## 流程

```text
job + facts + skills + autofill
  → 事实分类（教育/实习/项目/技能/荣誉/其他）
  → 岗位关键词抽取（JD + 标题）
  → 关键词覆盖与硬性要求对照（学历、技能、岗位类别）
  → 简历组装（顺序、措辞包装、关键词前置）
  → resume.html（一页 A4，内联样式）
  → resume.pdf（Playwright 打印）
  → match-report.md（要求对照、覆盖、真实缺口、未验证标注）
  → form-answers.json（安全字段答案）
  → generation-audit.json（每条表述 → 事实 ID + 来源 + 状态 + 包装记录）
  → output/applications/YYYY-MM-DD_公司_岗位/
  → 仪表盘"去投递"返回申请包路径与填写清单
```

## 事实状态规则

- 默认模式：包含 `unverified` 事实，在 `match-report.md` 与 `generation-audit.json` 中逐条标注"未验证，投递前须核对"；简历本体不加标记。
- `--verified-only`：只使用已验证事实；当前事实库未确认时，简历主体为空并提示"请先确认事实"。
- 技能等级限制：`skills.yml` 为空时技能节从事实中抽取；未来按等级表（unverified/learning/basic/practical/strong）限制措辞强度。

## 包装规则（用户已确认允许包装）

允许：
- 调整板块顺序与条目顺序，岗位相关内容前置；
- 措辞润色与表达强化（仅当候选人确有对应证据）；
- 把 JD 关键词嵌入候选人确实具备的技能/经历描述；
- 精简与岗位无关的细节。

禁止（写入 audit 检查）：
- 新增公司、头衔、时间、数字、奖项、论文状态等事实；
- 把"了解"提升为"熟练"等无证据的强度升级；
- 编造岗位匹配或掩盖硬性缺口。

每次包装决策记录在 `generation-audit.json` 的 `packaging` 字段。

## 申请包结构

```text
output/applications/YYYY-MM-DD_公司_岗位/
├── job-description.md
├── match-report.md
├── resume.html
├── resume.pdf
├── form-answers.json
└── generation-audit.json
```

## 接口设计

- `lib/resume-builder.mjs`
  - `classifyFacts(facts)` → `{ education, internship, project, skills, honors, other }`
  - `extractJobKeywords(job)` → `{ required, preferred }`（学历词、技能词、方向词）
  - `buildMatchReport({ job, candidate, keywords, coverage })` → Markdown 字符串
  - `buildResumeHtml({ candidate, job, sections })` → 一页 HTML
  - `buildFormAnswers(candidate)` → JSON 对象
  - `buildAudit({ facts, job, packaging })` → JSON 对象
- `lib/application-generator.mjs`
  - `generateApplicationPackage({ job, root, options })` → 完整申请包（写全部 6 个文件）
  - 内部用 Playwright 把 `resume.html` 打印为 `resume.pdf`
- `lib/career-ops-bridge.mjs`：`createApplicationPackage` 升级为调用完整生成器（向后兼容现有调用方）
- `scripts/generate-application.mjs <jobId> [--verified-only]`：命令行入口
- 仪表盘 `POST /api/apply`：沿用 `createApplicationPackage`，响应附加申请包路径

## 错误处理

- 事实文件缺失/空 → 明确报错并提示运行 `node scripts/import-profile.mjs`。
- 岗位缺公司/标题/JD → 拒绝生成（沿用现有校验）。
- 简历生成失败时保留 JD 与匹配报告，不发布半成品 PDF（删除残留 PDF）。
- 关键词抽取失败不阻塞生成，匹配报告标注"关键词分析不可用"。

## 测试策略（TDD）

- 事实分类：样例事实进入正确板块。
- 简历 HTML：包含六个板块、个人信息、JD 关键词命中项。
- 匹配报告：包含硬性要求对照、覆盖关键词、真实缺口、未验证标注。
- 表单答案：安全字段完整，敏感字段不出现。
- 审计：每条表述映射事实 ID + 状态；包装记录存在；无虚构事实追加。
- 申请包生成：临时目录内 6 个文件齐全，PDF 存在且非空。
- 用真实 `facts.yml` + 真实岗位（如 卫宁健康/小米）做集成验证。

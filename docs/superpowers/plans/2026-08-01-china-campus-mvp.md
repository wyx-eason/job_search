# 国内校招求职 MVP 实施计划

> **面向代理执行者：** 实施本计划时，按任务逐项执行；每个任务完成后运行对应测试并提交一次小变更。

**目标：** 搭建一个中文、本地优先的 2027 届校招 MVP，能导入个人事实、标准化岗位、执行届别与地域排序、生成每日摘要，并为后续 `career-ops` 简历生成和 Chrome 预填保留稳定接口。

**架构：** 使用 Node.js 纯 JavaScript 与 SQLite 文件实现核心数据层，先接入可测试的本地 JSON 岗位源和 `career-ops` 公开岗位导入；用 YAML/JSON 保存候选人事实与偏好。扫描、筛选、去重、排序和报告均由独立模块组成，后续浏览器和更多来源通过相同数据契约接入。

**技术栈：** Node.js 20、内置 `node:test`、SQLite（优先 Node 内置 `node:sqlite`，不可用时使用 JSON 兼容降级存储）、YAML/JSON、中文 Markdown 报告、Windows Task Scheduler 文档。

---

## 文件结构

- `AGENTS.md`：项目中文、隐私、自动提交边界。
- `candidate/facts.yml`：已确认候选人事实。
- `candidate/skills.yml`：技能等级和简历措辞权限。
- `candidate/preferences.yml`：岗位、城市、届别和排序偏好。
- `candidate/autofill.yml`：普通表单字段；不保存密码、验证码或身份证号。
- `candidate/pending-questions.md`：待向用户确认的事实问题。
- `config/sources.json`：来源注册表及来源类型。
- `data/schema.sql`：岗位、来源、扫描和状态表结构。
- `data/.gitkeep`：保留运行数据目录，运行数据库由 `.gitignore` 排除。
- `lib/validate-candidate.mjs`：候选人资料校验。
- `lib/job-contract.mjs`：岗位标准化、届别判定和去重指纹。
- `lib/ranking.mjs`：地域池与匹配排序。
- `lib/store.mjs`：运行数据读写接口。
- `scripts/import-profile.mjs`：从 `../profile/*.tex` 生成初始待确认资料草稿，不自动提升技能等级。
- `scripts/ingest-json.mjs`：导入统一 JSON 岗位源。
- `scripts/daily-scan.mjs`：执行导入、筛选、去重、排序和报告。
- `scripts/report.mjs`：生成中文每日 Markdown 摘要。
- `scripts/print-schedule-command.mjs`：输出 Windows 每日任务注册命令，不直接注册系统任务。
- `reports/daily/.gitkeep`：每日报告目录。
- `tests/*.test.mjs`：所有核心规则测试。
- `.gitignore`：排除个人资料、数据库、报告、Chrome 配置和生成材料。
- `package.json`：Node 运行脚本。

### 任务 1：建立中文项目骨架与安全忽略规则

**文件：**

- 创建：`package.json`
- 创建：`.gitignore`
- 创建：`candidate/facts.yml`
- 创建：`candidate/skills.yml`
- 创建：`candidate/preferences.yml`
- 创建：`candidate/autofill.yml`
- 创建：`candidate/pending-questions.md`
- 创建：`config/sources.json`
- 创建：`data/.gitkeep`
- 创建：`reports/daily/.gitkeep`
- 创建：`tests/smoke.test.mjs`

- [ ] 写入最小 Node 项目配置，脚本包括 `test`、`validate`、`import:profile`、`scan` 和 `report`。
- [ ] 将运行数据库、个人候选资料、岗位报告、输出材料、Chrome 配置和日志加入 `.gitignore`。
- [ ] 填写候选人目标偏好：2027 届、AI 应用/ADAS、临汾 150 公里、西安、其他大城市练手。
- [ ] 写入只含字段结构的空白普通自动填写配置，不放入真实身份证或密码。
- [ ] 写入烟雾测试，验证目录与 `package.json` 脚本存在。
- [ ] 运行 `node --test tests/smoke.test.mjs`，预期通过。
- [ ] 提交：`git add . && git commit -m "chore: initialize Chinese campus MVP"`。

### 任务 2：实现候选人资料校验与技能等级规则

**文件：**

- 创建：`lib/validate-candidate.mjs`
- 创建：`tests/validate-candidate.test.mjs`
- 修改：`candidate/facts.yml`
- 修改：`candidate/skills.yml`

- [ ] 先写测试：缺少毕业时间、技能状态非法、`strong` 缺少证据时返回错误；合法 `basic/practical` 资料通过。
- [ ] 运行 `node --test tests/validate-candidate.test.mjs`，预期先失败。
- [ ] 实现 `validateCandidate({ facts, skills, preferences })`，返回 `{ valid, errors, warnings }`。
- [ ] 允许状态仅为 `unverified`、`learning`、`basic`、`practical`、`strong`。
- [ ] 强制 `basic` 至少有一条验证证据；`practical` 至少有项目/实习上下文；`strong` 至少有结果或明确所有权证据。
- [ ] 对“已发表”和“小修中”同时出现的论文事实报错，避免沿用原简历矛盾表述。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add lib tests candidate && git commit -m "feat: validate candidate evidence"`。

### 任务 3：实现岗位数据契约、届别判定和去重

**文件：**

- 创建：`lib/job-contract.mjs`
- 创建：`tests/job-contract.test.mjs`
- 创建：`examples/jobs.fixture.json`

- [ ] 先写测试覆盖：2027 届正式校招通过，2027 提前批通过，实习/社招/已过期排除，仅写应届生进入待确认，官方职位号优先生成指纹。
- [ ] 运行 `node --test tests/job-contract.test.mjs`，预期先失败。
- [ ] 实现 `normalizeJob(raw)`，统一公司、岗位、城市、链接、时间、届别和描述字段。
- [ ] 实现 `classifyEligibility(job, now)`，返回 `eligible`、`excluded` 或 `needs_cohort_confirmation` 及原因。
- [ ] 实现 `jobFingerprint(job)`，优先 `source + source_job_id`，否则使用标准化公司、岗位、城市、批次和描述哈希。
- [ ] 实现 `mergeJobs(jobs)`，合并重复岗位并保留所有来源链接，官方链接作为主链接。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add lib tests examples && git commit -m "feat: normalize and qualify campus jobs"`。

### 任务 4：实现地域池与排序

**文件：**

- 创建：`lib/ranking.mjs`
- 创建：`tests/ranking.test.mjs`
- 修改：`candidate/preferences.yml`

- [ ] 先写测试：临汾附近泛技术岗位进入 `linfen_area`，西安 AI/ADAS 岗位进入 `xian_core`，上海等城市进入 `practice_city`；练手池每日上限为 5。
- [ ] 运行 `node --test tests/ranking.test.mjs`，预期先失败。
- [ ] 实现 `classifyPool(job, preferences)`，支持实际距离、估算距离和未知地点标记。
- [ ] 实现 `scoreJob(job, candidate)`，分别计算岗位匹配、地域、时效、来源可信度和学习成本，不把不同池混成单一分数。
- [ ] 实现 `rankPools(jobs, candidate)`，返回三个排序数组以及待确认数组。
- [ ] 采用可解释分数对象，例如 `{ role, location, freshness, source, gap, total }`，并保留评分原因。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add lib tests candidate && git commit -m "feat: rank jobs by location and fit pools"`。

### 任务 5：实现本地运行存储与 JSON 岗位导入

**文件：**

- 创建：`data/schema.sql`
- 创建：`lib/store.mjs`
- 创建：`scripts/ingest-json.mjs`
- 创建：`tests/store.test.mjs`
- 修改：`.gitignore`

- [ ] 先写测试：新岗位写入、重复岗位幂等、来源 URL 保留、已过期岗位保留历史并更新状态。
- [ ] 运行 `node --test tests/store.test.mjs`，预期先失败。
- [ ] 定义 `jobs`、`job_sources`、`scan_runs`、`applications` 表，字段与设计文档一致。
- [ ] 实现 `openStore(path)`、`upsertJobs(jobs)`、`listJobs(filters)`、`recordScan(run)`、`updateJobStatus(id, status)`。
- [ ] 优先使用 Node 20 的 `node:sqlite`；如果当前运行时不支持，使用相同接口的 JSON 文件降级存储，并在报告中标明降级。
- [ ] 实现 `node scripts/ingest-json.mjs examples/jobs.fixture.json`，输出新增、更新、重复和排除数量。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add data lib scripts tests .gitignore && git commit -m "feat: persist normalized job data"`。

### 任务 6：从现有简历生成候选人待确认草稿

**文件：**

- 创建：`scripts/import-profile.mjs`
- 创建：`tests/import-profile.test.mjs`
- 修改：`candidate/pending-questions.md`

- [ ] 先写测试：脚本能读取 `../profile/agent_llm_general_2026.tex` 和 `../profile/integration_adas_2026.tex`，提取教育、实习、项目、技能与奖项标题，并把未经确认的内容标为 `unverified`。
- [ ] 运行 `node --test tests/import-profile.test.mjs`，预期先失败。
- [ ] 实现 UTF-8 文本读取与保守的 LaTeX 清理，只提取可稳定识别的字段，不尝试自动解释所有中文语句。
- [ ] 生成或更新 `candidate/facts.yml`、`candidate/skills.yml` 和 `candidate/pending-questions.md`，不得覆盖 `../profile`。
- [ ] 对论文状态、博世工作内容、实习指标和技能深度生成中文待确认问题。
- [ ] 运行测试并人工检查生成草稿没有把 `unverified` 写成 `practical` 或 `strong`。
- [ ] 提交：`git add scripts tests candidate && git commit -m "feat: import profile into verified-fact draft"`。

### 任务 7：实现每日扫描、中文摘要与计划任务说明

**文件：**

- 创建：`scripts/daily-scan.mjs`
- 创建：`scripts/report.mjs`
- 创建：`scripts/print-schedule-command.mjs`
- 创建：`tests/daily-scan.test.mjs`
- 创建：`docs/daily-scan.md`

- [ ] 先写测试：扫描可隔离单个来源失败，输出三个岗位池、待确认岗位和来源健康信息；无新增岗位时明确写“今日无新增”。
- [ ] 运行 `node --test tests/daily-scan.test.mjs`，预期先失败。
- [ ] 实现 `runDailyScan({ sources, store, now })`，串联导入、标准化、资格判定、去重、排序和持久化。
- [ ] 实现 `renderDailyReport(result)`，生成中文 Markdown 摘要，最多展示临汾 10、西安 10、练手 5 条。
- [ ] 为每个来源记录成功、失败、交互待办和未知盲区。
- [ ] 实现 `print-schedule-command.mjs`，只打印 Windows Task Scheduler 注册命令，不自动修改系统任务。
- [ ] 编写中文运行说明，包括手动运行、日志位置和 Chrome 交互补充流程。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add scripts tests docs && git commit -m "feat: add daily Chinese campus scan"`。

### 任务 8：接入 `career-ops` 桥接接口与 Chrome 边界骨架

**文件：**

- 创建：`lib/career-ops-bridge.mjs`
- 创建：`lib/chrome-application.mjs`
- 创建：`tests/application-boundary.test.mjs`
- 创建：`docs/chrome-prefill.md`

- [ ] 先写测试：岗位包路径稳定、状态只能从 `ready_for_review` 进入；代码源中不存在点击最终提交按钮的调用。
- [ ] 运行 `node --test tests/application-boundary.test.mjs`，预期先失败。
- [ ] 实现 `createApplicationPackage(job, candidate)`，只生成 JD、匹配报告和调用参数，不在 MVP 中重复实现 `career-ops` 的简历生成逻辑。
- [ ] 实现 `prepareChromeApplication({ applyUrl, packagePath, profileDir })` 的安全骨架：校验 HTTPS 主机、打开目标 URL、返回人工操作清单；不保存密码、不点击提交。
- [ ] 在文档中明确 Chrome 专用配置目录、手动登录、敏感字段确认和最终提交边界。
- [ ] 运行测试，预期全部通过。
- [ ] 提交：`git add lib tests docs && git commit -m "feat: add career-ops bridge and safe browser boundary"`。

### 任务 9：全量验证与交付检查

**文件：**

- 修改：`README.md`
- 创建：`docs/verification-record.md`

- [ ] 编写中文 README，说明安装 Node、初始化候选人资料、导入岗位、运行每日扫描和查看报告。
- [ ] 运行 `npm test`，预期所有 Node 测试通过。
- [ ] 运行 `node scripts/import-profile.mjs`，确认只读 `../profile` 并生成待确认草稿。
- [ ] 运行 `node scripts/daily-scan.mjs --input examples/jobs.fixture.json`，确认生成中文日报且三个池的数量符合限制。
- [ ] 运行 `git diff --check` 和中文文档扫描，确认无占位符、无不必要英文标题和无敏感文件被跟踪。
- [ ] 将命令、测试结果、已知限制和未实现的登录型平台记录到 `docs/verification-record.md`。
- [ ] 提交：`git add README.md docs && git commit -m "docs: document and verify campus MVP"`。

## 自审结果

- 规格中的候选人资料、岗位资格、地域排序、每日扫描、中文输出、简历桥接、Chrome 边界、隐私和分阶段交付均有对应任务。
- 所有任务均包含明确文件、测试命令和预期结果，没有 `TODO`、`TBD` 或“适当处理”等占位描述。
- `normalizeJob`、`classifyEligibility`、`jobFingerprint`、`rankPools`、`openStore` 和 `runDailyScan` 的接口在后续任务中保持一致。
- 登录型平台和最终提交不在 MVP 的无人值守范围内，符合已确认边界。

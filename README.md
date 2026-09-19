# 国内校招求职 MVP

这是面向王奕迅的 2027 届国内校招求职扩展，复用 `career-ops` 处理岗位评估、中文简历、投递跟踪和学习分析。

当前版本已经具备：

- 2027 届正式校招与提前批资格判定。
- 临汾周边、西安和大城市练手三个岗位池。
- 跨来源职位编号去重和 SQLite 持久化。
- 从 `../profile/` 两份 LaTeX 简历生成未确认事实草稿。
- 中文每日摘要和来源异常报告。
- 申请包生成与浏览器（默认 Edge）预填安全边界。

## 运行环境

本项目零依赖（无 node_modules），但需要支持 `node:sqlite` 的 Node（22.5+，捆绑 Node v24 已验证可用）。系统命令行 PATH 里没有 `node`，且不建议手动改 PATH——部分 PowerShell 会话会报"文件名、目录名或卷标语法不正确"。正确做法是直接使用捆绑 Node 的绝对路径，或使用仓库根目录的一键脚本：

```
C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

## 一键启动（推荐）

在 PowerShell 或资源管理器中运行仓库根目录的 `start-scan.cmd`：

```powershell
.\start-scan.cmd
```

脚本会自动切换到项目目录、用捆绑 Node 执行每日扫描（示例岗位数据）、最后提示日报和数据库的位置。

## 仪表盘

本地 Web 仪表盘（只读展示，与扫描器共享同一个 `data/jobs.db`），双击 `start-dashboard.cmd` 或运行：

```powershell
.\start-dashboard.cmd
```

启动后浏览器打开 `http://127.0.0.1:8787`，可查看今日新增、三个排序池、待确认岗位、全部岗位和来源健康状态。页面数据来自只读接口 `/api/dashboard`，仪表盘不维护独立状态。

## 常用命令

进入 `E:\job_search\china-campus-ops` 后，把下面命令中的 `NODE` 换成上方的 Node 绝对路径：

```powershell
# 运行全部测试（15 项）
& $NODE --test tests/*.test.mjs

# 从 ../profile 简历生成待确认草稿（会覆盖 candidate 下的草稿文件）
& $NODE scripts/import-profile.mjs

# 每日扫描 + 生成中文日报（可把示例文件换成真实岗位 JSON）
& $NODE scripts/daily-scan.mjs examples/jobs.fixture.json

# 在线扫描：抓取已接入的真实来源（当前为云就业高校就业信息网）并入库存档
& $NODE scripts/daily-scan.mjs --online

# 打印 Windows 计划任务注册命令（只打印，不注册）
& $NODE scripts/print-schedule-command.mjs
```

原始简历位于项目外的 `../profile/`，导入脚本只读它们，并将所有提取内容标为 `unverified`。

日报写入 `reports/daily/YYYY-MM-DD.md`，运行数据库写入 `data/jobs.db`。个人数据、申请包、浏览器配置和报告默认不进入 Git。

## 投递边界

系统可以生成岗位定制包、打开申请页、填写安全字段和上传简历，但永远不会点击最终提交。敏感字段必须逐项确认，验证码和密码不保存。

## 投递助手（浏览器预填）

仪表盘每条岗位有"去投递"按钮：点击后自动生成申请包，用 Edge 以专用配置目录 `local/edge-profile/`（首次需手动登录一次，登录态由浏览器保存）打开投递页，并按 `candidate/autofill.yml` 与 `facts.yml` 自动填写姓名、手机、邮箱、学校、学历、专业、毕业时间等安全字段。投递窗口以最大化、100% 缩放打开；每次只保留一个投递会话，点击其他岗位会先关闭旧窗口再开新窗口。

仪表盘每条岗位还有"删除公司"按钮：确认后移除该公司全部岗位并加入屏蔽名单，之后扫描不会重新加入；页面底部"已屏蔽公司"区域可恢复（恢复后需重新扫描才会加回岗位）。屏蔽名单存在 `data/jobs.db` 的 `blocked_companies` 表。

简历版式采用与原始 LaTeX 简历一致的经典模板（姓名/联系方式置顶、五节分栏、日期右对齐、要点加粗关键词），由 `lib/resume-classic.mjs` 渲染；AI/ADAS 基类按 JD 方向自动选择，AI 基类内容为定稿的博世 AI 实习扩写版与霍莱沃"仿真数据处理与工具开发"口径。

敏感字段（身份证、详细地址、政治面貌、民族、薪资、地点调剂、工作授权、背景调查、真实性声明、电子签名、密码/验证码等）一律留空并提示逐项确认。助手永远不会点击"提交/发送/申请"，停在最后一步由你手动完成。

浏览器与 Playwright 路径配置在 `config/apply.json`：投递页面用 `applyBrowserExecutable` / `applyProfileDir`（默认 Edge + `local/edge-profile/`），简历 PDF 与 JD 补全用的无头浏览器仍是 `browserExecutable` / `profileDir`（Chrome）；本机路径变化时修改该文件。Edge 缺失时投递流程会自动回退到 Chrome。

### 自动导航（ATS）

点"去投递"后，助手会识别招聘系统并自动定位具体岗位：搜索岗位关键词 → 打开岗位卡片 → 点击"立即投递/申请职位" → 等待申请表单出现后自动填写。**唯一匹配自动打开；多个匹配时按 `candidate/preferences.json` 的目标方向打分，唯一最高分自动打开，无法确定则停在列表让你手动选择**。已支持 mokahr、飞书校招、zhiye 三家（覆盖库内 46/85 条符合岗位）；登录、验证码、表单中无法识别的字段仍需手动完成，登录态保存在 `local/edge-profile/` 会保持。

## 定制申请包生成

选定岗位后（命令行或仪表盘"去投递"）自动生成完整申请包到 `output/applications/YYYY-MM-DD_公司_岗位/`：

- `job-description.md`：归档 JD
- `resume.html` / `resume.pdf`：一页中文简历（事实自动分类到教育/实习/项目/技能/荣誉板块，JD 关键词突出显示）
- `match-report.md`：硬性要求对照、关键词覆盖、真实缺口、未验证事实清单
- `form-answers.json`：安全字段答案
- `generation-audit.json`：每条简历表述 → 事实 ID + 来源 + 验证状态 + 包装记录

简历优化：自动选择与 JD 最匹配的简历版本（AI 应用版 / ADAS 版，避免两份合并）；**岗位匹配亮点**：解析 JD 职责与任职要求，逐条从真实经历中挑选最相关证据生成"针对「要求」：相关经历"条目置于简历顶部；技能板块按 JD 关键词命中排序；实习/项目条目中命中 JD 的句子前置、其余压缩到 1-2 句；纯黑加粗、简洁单页 A4 排版。每次生成后自动 QA 筛查（结构完整、无 LaTeX 残留/乱码、无敏感字段泄露、JD 关键词覆盖、PDF 单页长度），结果写入 `generation-audit.json` 并在仪表盘提示。

命令：`node scripts/generate-application.mjs <jobId>`（加 `--verified-only` 只使用已验证事实）。默认模式包含未验证事实并在报告中标注，投递前请核对。

包装规则：允许调整板块顺序、措辞润色、关键词前置；禁止新增公司/头衔/时间/数字/奖项/论文状态。

JD 自动抓取：当岗位库里的 JD 过粗（如腾讯文档来源只有"方向：汽车, 自动驾驶"），生成申请包时会自动打开投递页抓取真实岗位职责与任职要求，简历关键词和匹配报告基于真实 JD 生成；抓取失败时回退到岗位库 JD，并在 `generation-audit.json` 记录 JD 来源。

## 投递状态流转

状态流程：`已发现 → 已入选择 → 已生成简历 → 待检查 → 已投递 → 测评中 → 面试中 → Offer`；终态：`已拒绝 / 已撤回 / 已过期 / 已丢弃`（任意活跃状态可进入终态，终态不可再流转）。

仪表盘"投递状态"板块可按下一步推进或标记拒绝/撤回；命令行：`node scripts/update-status.mjs <jobId> <status>`。标记"已投递"时记录投递时间到 `applications` 表。

## 真实来源接入

来源适配器框架位于 `lib/source-adapter.mjs`，每个适配器把站点数据转换为统一 JSON，再复用标准化、资格判定、去重和入库管线；单个来源失败不会影响其他来源，失败会写进日报的"来源异常"。

- 已接入 5 个真实来源：
  - `yunjiuye`（云就业高校就业信息网，服务端渲染岗位详情页）；
  - `smartcampus`（智慧就业平台招聘公告，覆盖多所高校与 24365 平台，已过期公告自动跳过）；
  - `zggqzp`（国企招聘网公告，GBK 编码，含投递截止时间）。
  - `qqdocs`（腾讯文档校招内推合集，社区维护的秋招/实习内推表，含内推码和投递链接）。
  - `yingjiesheng`（应届生求职网转载的院校审核岗位页，含职位描述/学历要求/薪资，如云天励飞 AI 建模、兆芯、蓝箭鸿擎）。
- 企业/来源注册表：`config/companies.json`（临汾周边、西安、全国能源央企、公开平台四组，含已核实官网与备注）。
- 待接入：国聘、牛客、国家大学生就业服务平台等是纯 JS 或需登录，走浏览器交互流程；BOSS、智联、前程无忧、猎聘等登录型平台需浏览器辅助（默认 Edge），不做无人值守抓取，也不做自动登录。

## 已知限制

当前已接入第一个真实来源（云就业高校就业信息网），其余企业官网、国聘、牛客、高校就业网及登录型平台适配器将逐个增加；登录平台需要浏览器交互（默认 Edge），不能假装无人值守覆盖全部岗位。

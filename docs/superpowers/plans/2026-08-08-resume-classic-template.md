# 简历经典版式模板与 AI 基类内容更新 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让简历生成使用复刻原 LaTeX 排版的经典 HTML 模板，并把已确认的 AI 基类新内容（博世扩写、霍莱沃新口径）落进 facts.yml。

**Architecture:** 新增独立渲染模块 `lib/resume-classic.mjs` 输出经典版式 HTML（姓名/联系方式置顶、五节、日期右对齐、角色+技术栈行、要点加粗）；`application-generator.mjs` 改用它渲染；`candidate/facts.yml` 的 AI 版 claim 替换为定稿内容；方向选择、LLM 润色、PDF 预览、意见反馈逻辑全部不动。

**Tech Stack:** Node.js（bundled runtime，无新增依赖）、HTML/CSS → 无头 Chrome PDF、SQLite（不动）、现有 LLM 润色接口（不动）。

---

## 文件结构

- 新建 `lib/resume-classic.mjs`：经典版式渲染器（唯一职责：把 sections 渲染成原版式 HTML）。
- 新建 `tests/resume-classic.test.mjs`：渲染器专项测试。
- 修改 `candidate/facts.yml`：AI 版 claim 替换为定稿内容（`id: claim-ai`，`source: agent_llm_general_2026.tex`）。
- 修改 `lib/application-generator.mjs`：渲染调用切换到 `buildClassicResumeHtml`。
- 修改 `lib/resume-builder.mjs`：`optimizeForJob` 技能项长度上限 100 → 180（技能内容更完整，旧模板同样受益）。
- 修改 `tests/resume-builder.test.mjs`：更新"AI 岗生成聚焦简历"断言以匹配新内容。
- 修改 `README.md`：说明新版式。

---

### Task 1: 编写经典模板渲染器测试（先红）

**Files:**
- Create: `tests/resume-classic.test.mjs`

- [ ] **Step 1: 写测试文件**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildClassicResumeHtml, parseEducation, splitRoleLine } from "../lib/resume-classic.mjs";

const candidate = {
  name: "王奕迅",
  phone: "13800000000",
  email: "redacted@example.com",
  university: "西安电子科技大学",
  major: "控制科学与工程",
  degree: "硕士",
  graduation: "2027-06"
};

const sections = {
  education: [
    "西安电子科技大学, 西安 2024.09 -- 2027.06",
    "硕士研究生 控制科学与工程 专业排名: 前 20",
    "浙江科技大学, 杭州 2020.09 -- 2024.06",
    "工学学士 自动化 专业排名: 2/95 (Top 2)"
  ],
  internship: [
    "博世 (Bosch) · 苏州 2026.03 -- 至今。AI 应用开发实习生 | 智驾匹配部门 | Python, LLM, RAG, Agent, Prompt Engineering。独立设计并实现基于 AI Agent 的问答系统，采用三层 Agent 架构。"
  ],
  project: ["飞艇仿真训练系统 2025.04 -- 至今。独立负责人 | Python, PyTorch。实现 PPO/D3QN 算法。"],
  skills: ["大模型与 AI 应用：熟悉 LLM、RAG 与 Agent 应用。"],
  honors: ["核心竞赛 | 全国大学生智能汽车竞赛三等奖、浙江省智能汽车竞赛二等奖 2022-2023"],
  other: []
};

const keywords = { all: ["llm", "rag", "agent", "python"] };
const html = buildClassicResumeHtml({ candidate, sections, keywords });

test("经典模板包含姓名、联系方式与五个分节", () => {
  assert.match(html, /<h1>王奕迅<\/h1>/);
  assert.match(html, /\(&plus;86\)|\(\+86\)|13800000000/);
  assert.match(html, /教育背景/);
  assert.match(html, /实习经历/);
  assert.match(html, /项目经历/);
  assert.match(html, /技术技能/);
  assert.match(html, /荣誉与奖项/);
});

test("教育背景日期右对齐、学校左对齐", () => {
  assert.match(html, /class="dated-row"/);
  assert.match(html, /class="date">2024\.09 -- 2027\.06<\/span>/);
});

test("实习条目：公司行、角色+技术栈行、要点加粗", () => {
  assert.match(html, /博世 \(Bosch\) · 苏州/);
  assert.match(html, /AI 应用开发实习生/);
  assert.match(html, /class="tech">Python/);
  assert.match(html, /<strong>LLM<\/strong>/i);
  assert.match(html, /三层 Agent 架构/);
});

test("荣誉行标题左对齐、年份右对齐", () => {
  assert.match(html, /全国大学生智能汽车竞赛三等奖/);
  assert.match(html, /class="date">2022-2023<\/span>/);
});

test("不渲染核心优势/岗位匹配亮点板块，无敏感字段与 LaTeX 残留", () => {
  assert.ok(!html.includes("核心优势"));
  assert.ok(!html.includes("岗位匹配亮点"));
  assert.ok(!html.includes("身份证") && !html.includes("政治面貌"));
  assert.ok(!html.includes("ctex") && !html.includes("\\item"));
});

test("parseEducation 把学校行与详情行配对", () => {
  const entries = parseEducation(sections.education);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].school, "西安电子科技大学, 西安");
  assert.equal(entries[0].date, "2024.09 -- 2027.06");
  assert.deepEqual(entries[0].detail, ["硕士研究生 控制科学与工程 专业排名: 前 20"]);
});

test("splitRoleLine 切分角色/部门/技术栈", () => {
  const { role, dept, tech } = splitRoleLine("AI 应用开发实习生 | 智驾匹配部门 | Python, LLM, RAG");
  assert.equal(role, "AI 应用开发实习生");
  assert.equal(dept, "智驾匹配部门");
  assert.equal(tech, "Python, LLM, RAG");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\resume-classic.test.mjs`
Expected: FAIL（找不到模块 `../lib/resume-classic.mjs`）

- [ ] **Step 3: 提交测试**

```bash
git add tests/resume-classic.test.mjs
git commit -m "test: classic resume template renderer specs"
```

---

### Task 2: 实现经典模板渲染器（变绿）

**Files:**
- Create: `lib/resume-classic.mjs`

- [ ] **Step 1: 写实现**

```js
import { optimizeForJob } from "./resume-builder.mjs";

const SECTION_TITLES = {
  education: "教育背景",
  internship: "实习经历",
  project: "项目经历",
  skills: "技术技能",
  honors: "荣誉与奖项"
};

const DATE_RE = /(20\d{2}\.\d{2}\s*--\s*(?:20\d{2}\.\d{2}|至今))/;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function highlight(text, keywords) {
  let out = esc(text);
  const sorted = [...(keywords?.all || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const keyword of sorted) {
    const pattern = new RegExp(esc(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(pattern, (m) => `<strong>${m}</strong>`);
  }
  return out;
}

function splitSentences(text) {
  return String(text)
    .split(/(?<=[。！？!?；;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractDate(text) {
  const m = String(text || "").match(DATE_RE);
  return m ? m[1].trim() : "";
}

function stripDateAndPunct(text) {
  return String(text || "")
    .replace(DATE_RE, "")
    .replace(/[。｜|]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEducation(items) {
  const entries = [];
  for (const item of items || []) {
    const date = extractDate(item);
    if (date) {
      entries.push({ school: stripDateAndPunct(item), date, detail: [] });
    } else if (entries.length) {
      entries[entries.length - 1].detail.push(item);
    } else {
      entries.push({ school: item, date: "", detail: [] });
    }
  }
  return entries;
}

export function splitRoleLine(line) {
  const parts = String(line || "").split(" | ").map((s) => s.trim()).filter(Boolean);
  const role = parts.shift() || "";
  const dept = parts[0] || "";
  const tech = parts.slice(1).join(" | ");
  return { role, dept, tech };
}

function extractHonorDate(text) {
  const s = String(text || "").trim();
  const range = s.match(/(20\d{2}(?:\.\d{2})?)\s*[-–—~]\s*(20\d{2}(?:\.\d{2})?)\s*$/);
  if (range) return `${range[1]}-${range[2]}`;
  const single = s.match(/(20\d{2}(?:\.\d{2})?)\s*$/);
  return single ? single[1] : "";
}

function renderDatedRow(left, date, keywords) {
  return `<div class="dated-row"><span class="left">${highlight(left, keywords)}</span>${date ? `<span class="date">${esc(date)}</span>` : ""}</div>`;
}

function renderEntry(item, keywords) {
  const sentences = splitSentences(item);
  if (!sentences.length) return "";
  const head = sentences[0];
  const date = extractDate(head);
  let roleRow = "";
  let techRow = "";
  const bullets = [];
  for (const sentence of sentences.slice(1)) {
    const s = sentence.replace(/[。]$/, "").trim();
    if (/^技术[:：]/.test(s)) {
      if (!techRow) techRow = `<div class="tech-row">${highlight(s.replace(/^技术[:：]\s*/, ""), keywords)}</div>`;
    } else if (s.includes(" | ") && s.length <= 150 && !roleRow) {
      const { role, dept, tech } = splitRoleLine(s);
      roleRow = `<div class="role-row"><span class="role">${highlight([role, dept].filter(Boolean).join(" | "), keywords)}</span>${tech ? `<span class="tech">${highlight(tech, keywords)}</span>` : ""}</div>`;
    } else {
      bullets.push(`<li>${highlight(s, keywords)}</li>`);
    }
  }
  return `${renderDatedRow(stripDateAndPunct(head), date, keywords)}${roleRow}${techRow}${bullets.length ? `<ul class="entry">${bullets.join("")}</ul>` : ""}`;
}

function renderDatedLine(item, keywords) {
  const date = extractHonorDate(item);
  const left = date ? String(item).replace(new RegExp(`${date.replace(/[-.]/g, "\\$&")}\\s*$`), "").replace(/[。]$/, "").trim() : String(item).replace(/[。]$/, "").trim();
  return `<div class="dated-row"><span class="left">${highlight(left, keywords)}</span>${date ? `<span class="date">${esc(date)}</span>` : ""}</div>`;
}

export function buildClassicResumeHtml({ candidate, sections, keywords, job }) {
  const optimized = optimizeForJob(sections, keywords);
  const blocks = [];
  for (const key of ["education", "internship", "project", "skills", "honors"]) {
    const items = (optimized[key] || []).filter(Boolean);
    if (!items.length) continue;
    let inner = "";
    if (key === "education") {
      inner = parseEducation(items)
        .map((e) => `${renderDatedRow(e.school, e.date, keywords)}${e.detail.length ? `<div class="detail">${highlight(e.detail.join("；"), keywords)}</div>` : ""}`)
        .join("");
    } else if (key === "internship" || key === "project") {
      inner = items.map((item) => renderEntry(item, keywords)).join("");
    } else if (key === "honors") {
      inner = items.map((item) => renderDatedLine(item, keywords)).join("");
    } else {
      inner = `<ul class="entry">${items.map((item) => `<li>${highlight(item, keywords)}</li>`).join("")}</ul>`;
    }
    blocks.push(`<h2>${SECTION_TITLES[key]}</h2>${inner}`);
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(candidate.name)} - 简历</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  body { font-family: "Times New Roman", SimSun, "Songti SC", serif; font-size: 10pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 17pt; text-align: center; margin: 0 0 2px; letter-spacing: 1px; }
  .contact { text-align: center; color: #444; font-size: 10pt; margin: 0 0 10px; }
  h2 { font-size: 11.5pt; margin: 9px 0 3px; padding-bottom: 2px; border-bottom: 1px solid #999; letter-spacing: .5px; }
  .dated-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px; }
  .dated-row .left { font-weight: 600; }
  .dated-row .date { color: #555; font-size: 9.5pt; white-space: nowrap; }
  .detail { margin-top: 1px; }
  .role-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 1px; }
  .role-row .role { font-style: italic; }
  .role-row .tech { color: #666; font-size: 9.5pt; text-align: right; }
  .tech-row { color: #666; font-size: 9.5pt; margin-top: 1px; }
  ul.entry { margin: 2px 0 0; padding-left: 18px; }
  ul.entry li { margin: 1px 0; }
  strong { font-weight: 700; }
</style>
</head>
<body>
<h1>${esc(candidate.name)}</h1>
<p class="contact">(+86) ${esc(candidate.phone)} ｜ ${esc(candidate.email)}</p>
${blocks.join("\n")}
</body>
</html>
`;
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\resume-classic.test.mjs`
Expected: PASS（7 个用例）

注意：测试断言 `class="date">2022-2023<\/span>` 依赖 `renderDatedLine` 的日期提取；若失败，检查 `extractHonorDate` 正则是否匹配"2022-2023"（`20\d{2}(?:\.\d{2})?` 前段 + `[-–—~]` + 后段）。

- [ ] **Step 3: 提交**

```bash
git add lib/resume-classic.mjs
git commit -m "feat: classic resume template renderer"
```

---

### Task 3: 替换 facts.yml 的 AI 基类内容

**Files:**
- Modify: `candidate/facts.yml`

- [ ] **Step 1: 替换 AI 版 claim**

把 `id: claim-1`、`source: agent_llm_general_2026.tex` 的那条 claim 整条替换为（注意 YAML 双引号字符串内 `\\` 表示一个反斜杠，`itemize` 会被解析器转为换行）：

```yaml
  - id: claim-ai
    type: claim
    claim: "resume [UTF8]ctex linespacing_fix cite hidelinks document gobble 王奕迅 redacted@example.com \\ (+86) 13800000000 \\ 教育背景 西安电子科技大学, 西安 2024.09 -- 2027.06 \\ 硕士研究生 控制科学与工程 专业排名: 前 20% \\ 浙江科技大学, 杭州 2020.09 -- 2024.06 \\ 工学学士 自动化 专业排名: 2/95 (Top 2%) \\ \\ 实习经历 博世 (Bosch) · 苏州 2026.03 -- 至今 \\ AI 应用开发实习生 | 智驾匹配部门 | Python, FastAPI, LLM API（GPT/Kimi）, RAG, FAISS, BM25, Cross-Encoder Rerank \\ itemize 独立设计并主导开发部门内部“AI 调参问答系统”（网页端，已正式上线）：面向匹配工程师，支持参数解释、调参建议、车辆表现诊断等问答场景。 \\ itemize 设计多阶段问答流水线：混合意图分类与能力路由 → 参数文档混合检索（BM25 + FAISS 向量 + AST 解析的代码知识）→ 交叉编码器重排 → 基于当前车辆值的参数查询与子问题分解 → LLM 生成带 Parameter Plan 的结构化回答。 \\ itemize 构建参数知识库：解析并入库近十份核心调参文档与源码知识（AST 解析），覆盖约 80 个调参参数（LQR/PID/轴值/DCM 等），建立主参数/条件参数/关联参数的依赖标注。 \\ itemize 解决 LLM 工程化不稳定问题：JSON Schema 结构化输出 + 白名单校验 + 失败二次生成，消除输出格式漂移与回答前后矛盾；混合意图识别（向量高阈值直判 + LLM 多轮裁决兜底）显著提升意图分类稳定性。 \\ itemize 自建检索评估 Gold 集，以 Recall@k 评估并迭代检索链路（Recall@4 ≈ 0.7+，持续调优）；上线后收集 40+ 条真实使用反馈持续改进。 \\ itemize 全程负责后端（FastAPI）与知识库工程，完成系统部署上线与迭代维护；在调参实践中完整了解 V 模型开发与匹配标定流程。 \\ 霍莱沃 · 西安 2025.07 -- 2025.10 \\ 电磁与信号感知部门 · 仿真数据处理与工具开发（实习） | Python, 数据分析, 可视化 \\ itemize 参与电磁仿真软件平台（面向雷达与无线通信场景，支持发射/接收链路、多类设备建模及真实地形环境）的仿真数据处理与工具开发：编写 Python 解析与特征提取脚本，处理电磁场分布、雷达脉冲信号等高维仿真数据，支撑电磁场热力图、脉冲参数分析等结果的可视化与验证。 \\ itemize 搭建仿真数据预处理与批量分析链路：实现多平台、多场景仿真数据的加载、清洗与对比，支撑仿真结果的问题定位与交付效率提升。 \\ \\ 项目经历 基于深度强化学习的飞艇仿真训练系统 (硕士课题) 2025.04 -- 至今 \\ 独立负责人 | Python, PyTorch, SB3, Gymnasium \\ itemize 构建四自由度飞艇仿真环境（气动/热力学/能源子系统），实现 PPO/D3QN 算法，采用向量化多进程并行采样与集群训练。 \\ itemize 主导状态/动作空间与奖励函数设计，完成多种子评估与泛化实验，积累 RL 训练 Pipeline（环境搭建→模型训练→评估调优）的完整理解。 \\ itemize 以第一作者在 SCI 期刊发表论文一篇（小修中）。 \\ 基于 ROS 的室外移动机器人自主导航系统 2022.10 -- 2023.01 \\ 核心开发 | ROS, C++, Linux, 多传感器融合 \\ itemize 在 Gazebo 中完成 Gmapping 建图、AMCL 定位、A* 规划联调，结合 EKF 多传感器融合与 PID 航向控制完成真实环境自主导航。 \\ \\ 技术技能 itemize 大模型与 AI 应用：具备 LLM 应用全链路工程经验——混合检索（BM25 + 向量）、交叉编码器重排、RAG 问答、结构化输出与校验、混合意图分类；熟悉 Prompt Engineering，了解 LLM 微调（LoRA/P-Tuning）基本概念。 \\ itemize 后端与工程化：熟练使用 Python（FastAPI 服务开发、Numpy/Pandas/PyTorch），有 API 设计与上线部署经验；了解 Docker（SQL/Redis 容器化）、Git、Linux。 \\ itemize AI 算法与强化学习：熟悉 PPO/DQN/SAC 等主流算法与完整 RL Pipeline，熟练使用 PyTorch、Stable-Baselines3。 \\ itemize 编程语言与工具：熟练使用 Python，掌握 C++ 基础与 STL，有嵌入式开发经验；熟悉 FAISS 向量检索、数据分析与自动化脚本开发。 \\ \\ 荣誉与奖项 核心竞赛 | 全国大学生智能汽车竞赛三等奖、浙江省智能汽车竞赛二等奖 2022-2023 \\ 荣誉奖学金 | 浙江省优秀毕业生、浙江省政府奖学金、多次一等奖学金、研究生期间校级二等奖学金 2022-2025 \\ 基础学科 | 全国大学生数学竞赛三等奖、浙江省大学生数学竞赛一等奖 2022-2023 document"
    source: agent_llm_general_2026.tex
    status: unverified
```

- [ ] **Step 2: 验证解析**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\resume-builder.test.mjs`
Expected: "事实按内容分类到简历板块" 通过；博世段含"多阶段问答流水线"、霍莱沃段含"电磁与信号感知部门"。

如果"事实按内容分类"断言失败，检查 claim 字符串里的 `\\` 是否在 YAML 解析后变成单个 `\`（可用 `loadFacts()` 打印前 200 字符确认）。

- [ ] **Step 3: 提交**

```bash
git add candidate/facts.yml
git commit -m "feat: replace AI base resume content in facts.yml"
```

---

### Task 4: application-generator 切换到经典模板

**Files:**
- Modify: `lib/application-generator.mjs`

- [ ] **Step 1: 改导入与调用**

在文件顶部把：

```js
import { buildResumeHtml } from "./resume-builder.mjs";
```

对应的导入列表中移除 `buildResumeHtml`，并新增：

```js
import { buildClassicResumeHtml } from "./resume-classic.mjs";
```

然后把：

```js
const html = buildResumeHtml({ candidate, sections, keywords, job: normalizedJob });
```

改为：

```js
const html = buildClassicResumeHtml({ candidate, sections, keywords, job: normalizedJob });
```

- [ ] **Step 2: 语法检查**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check lib\application-generator.mjs`
Expected: 无输出（成功）

- [ ] **Step 3: 提交**

```bash
git add lib/application-generator.mjs
git commit -m "feat: generate resumes with classic template"
```

---

### Task 5: 技能项长度上限调整

**Files:**
- Modify: `lib/resume-builder.mjs`

- [ ] **Step 1: 改长度上限**

在 `optimizeForJob` 中：

```js
.map((x) => optimizeItem(x.item, terms, 100));
```

改为：

```js
.map((x) => optimizeItem(x.item, terms, 180));
```

- [ ] **Step 2: 跑相关测试**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\resume-builder.test.mjs tests\resume-classic.test.mjs`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add lib/resume-builder.mjs
git commit -m "feat: keep fuller skill text in resume"
```

---

### Task 6: 更新 AI 岗生成测试断言

**Files:**
- Modify: `tests/resume-builder.test.mjs`

- [ ] **Step 1: 更新"AI 岗生成聚焦简历"断言**

把该测试中：

```js
assert.ok(plain.includes("三层 Agent 架构"), "AI 实习要点应完整保留");
assert.ok(plain.includes("BM25 混合检索"), "AI 实习要点应完整保留");
```

改为：

```js
assert.ok(plain.includes("多阶段问答流水线"), "AI 实习要点应完整保留");
assert.ok(plain.includes("Recall@4"), "AI 实习要点应完整保留");
assert.ok(plain.includes("白名单校验"), "AI 实习要点应完整保留");
assert.ok(plain.includes("电磁与信号感知部门"), "霍莱沃新口径应完整保留");
```

（`JSON Schema`、`不混入 ADAS 专属内容` 两条断言保持不变。）

- [ ] **Step 2: 运行测试**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\resume-builder.test.mjs`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add tests/resume-builder.test.mjs
git commit -m "test: update AI resume assertions for new base content"
```

---

### Task 7: 全量回归 + 端到端验证

**Files:** 无代码改动

- [ ] **Step 1: 全量测试**

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test`
Expected: 全部通过（含新增 resume-classic 用例）

- [ ] **Step 2: 端到端生成 AI 岗申请包（真实 LLM 润色）**

用临时脚本（完成后删除）：

```js
// local/debug-classic.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateApplicationPackage } from "../lib/application-generator.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "classic-"));
const job = {
  company_raw: "韶音科技",
  title_raw: "AI 应用工程师",
  jd_text: "岗位职责：负责大模型应用与智能体（Agent）开发，基于 RAG 构建企业知识问答系统，优化 LLM 推理效果。任职要求：熟悉 Python、LLM、Agent、RAG，硕士及以上学历，2027届。",
  posting_url: "https://example.com/apply"
};
const result = await generateApplicationPackage({ job, root: tmpRoot });
const html = fs.readFileSync(path.join(result.packagePath, "resume.html"), "utf8");
const plain = html.replace(/<[^>]+>/g, "");
console.log("qa:", JSON.stringify(result.qa, null, 2));
console.log("polish:", JSON.stringify(result.polish, null, 2));
console.log("hasClassicHeader:", html.includes('<p class="contact">'));
console.log("hasPipeline:", plain.includes("多阶段问答流水线"));
console.log("hasHolliwell:", plain.includes("电磁与信号感知部门"));
console.log("noCore:", !html.includes("核心优势"));
console.log("package:", result.packagePath);
```

Run: `& 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' local\debug-classic.mjs`
Expected: `qa.ok === true`、`polish.ok === true`、`hasClassicHeader === true`、`hasPipeline === true`、`hasHolliwell === true`、`noCore === true`

删除临时脚本：`Remove-Item -LiteralPath 'E:\job_search\china-campus-ops\local\debug-classic.mjs' -Force`

- [ ] **Step 3: 人工核对 PDF 单页**

用 `pdfplumber` 读取生成 PDF 的页数（脚本内输出 `len(pdf.pages)`），Expected: 1；若为 2，缩小字号（10pt→9.5pt）或行距（1.35→1.3）后重跑。

---

### Task 8: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 追加说明**

在"投递助手（浏览器预填）"一节末尾追加一行：

```md
简历版式采用与原始 LaTeX 简历一致的经典模板（姓名/联系方式置顶、五节分栏、日期右对齐、要点加粗关键词），由 `lib/resume-classic.mjs` 渲染；AI/ADAS 基类按 JD 方向自动选择。
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: note classic resume template"
```

---

## 自检记录

1. **Spec 覆盖**：版式规格 → Task 1/2；AI 基类内容 → Task 3；管线切换 → Task 4；技能完整 → Task 5；测试更新 → Task 6；验证 → Task 7；文档 → Task 8。
2. **无占位**：所有代码步骤均有完整实现；命令均带期望输出。
3. **一致性**：`buildClassicResumeHtml({ candidate, sections, keywords, job })` 与旧 `buildResumeHtml` 签名一致；`parseEducation`/`splitRoleLine` 在 Task 1 定义并在 Task 2 导出同名；`renderDatedLine` 使用 `extractHonorDate`，测试断言 `2022-2023` 格式。

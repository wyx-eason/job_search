import test from "node:test";
import assert from "node:assert/strict";
import { buildClassicResumeHtml, parseEducation, splitRoleLine, sanitizeEntryHead } from "../lib/resume-classic.mjs";

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
  assert.match(html, /class="tech">/);
  assert.match(html, /<strong>Python<\/strong>/);
  assert.match(html, /<strong>LLM<\/strong>/i);
  assert.match(html, /三层 <strong>Agent<\/strong> 架构/);
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
  const fullWidth = splitRoleLine("AI 应用开发实习生｜智驾匹配部门｜Python, LLM, RAG");
  assert.equal(fullWidth.role, "AI 应用开发实习生");
  assert.equal(fullWidth.dept, "智驾匹配部门");
  assert.equal(fullWidth.tech, "Python, LLM, RAG");
});

test("sanitizeEntryHead 允许改时间但阻止改公司或丢失日期", () => {
  const original = "博世 (Bosch) · 苏州 2026.03 -- 至今。";
  assert.equal(sanitizeEntryHead("博世 (Bosch) · 苏州 2026.04 -- 至今", original), "博世 (Bosch) · 苏州 2026.04 -- 至今");
  assert.equal(sanitizeEntryHead("博世 (Bosch) · 苏州 2026.04 -- 2026.09 2026.04 -- 2026.09", original), "博世 (Bosch) · 苏州 2026.04 -- 2026.09");
  assert.equal(sanitizeEntryHead("博世 (Bosch) · 苏州｜AI 应用开发实习生｜智驾匹配部门｜2026.04 -- 2026.09", original), "博世 (Bosch) · 苏州 2026.04 -- 2026.09");
  assert.equal(sanitizeEntryHead("博世 (Bosch) · 苏州 | AI 应用开发实习生 | 智驾匹配部门 | Python, LLM 2026.04 -- 2026.09", original), "博世 (Bosch) · 苏州 2026.04 -- 2026.09");
  assert.equal(sanitizeEntryHead("特斯拉 · 上海 2026.04 -- 至今", original), original);
  assert.equal(sanitizeEntryHead("博世 (Bosch) · 苏州", original), original);
});

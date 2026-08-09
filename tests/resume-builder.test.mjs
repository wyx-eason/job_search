import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadFacts,
  classifyFacts,
  selectBestFacts,
  selectBaseResumeFacts,
  pickResumeMode,
  mergeSectionsFromFacts,
  buildCoreHighlights,
  extractJobKeywords,
  optimizeForJob,
  buildResumeHtml,
  buildMatchReport,
  buildFormAnswers,
  buildAudit
} from "../lib/resume-builder.mjs";
import { generateApplicationPackage } from "../lib/application-generator.mjs";

const job = {
  id: "test-job-1",
  company_raw: "示例智驾公司",
  title_raw: "ADAS 算法工程师（2027届提前批）",
  jd_text: "岗位职责：负责 LQR 控制参数匹配与 AI Agent 问答系统开发，使用 Python 与 RAG。要求：硕士研究生及以上学历，熟悉 LLM、控制算法、自动驾驶，2027届应届毕业生。",
  posting_url: "https://example.com/apply/1"
};

test("事实按内容分类到简历板块", () => {
  const facts = loadFacts();
  const sections = classifyFacts(facts);
  assert.ok(sections.education.some((s) => s.includes("西安电子科技大学")));
  assert.ok(sections.internship.some((s) => s.includes("博世") || s.includes("Bosch")));
  assert.ok(sections.project.some((s) => s.includes("飞艇")));
  assert.ok(sections.skills.join(" ").includes("强化学习"));
  assert.ok(sections.honors.join(" ").includes("奖学金"));
});

test("岗位关键词抽取覆盖学历与技能词", () => {
  const keywords = extractJobKeywords(job);
  assert.ok(keywords.required.some((k) => k.includes("硕士")));
  assert.ok(keywords.all.some((k) => /python|llm|rag|控制|自动驾驶/i.test(k)));
});

test("简历 HTML 包含个人信息、板块和关键词强化，不出现敏感字段", () => {
  const facts = loadFacts();
  const candidate = buildFormAnswers();
  const keywords = extractJobKeywords(job);
  const sections = classifyFacts(selectBestFacts(facts, keywords));
  const html = buildResumeHtml({ candidate, sections, keywords });
  assert.match(html, /王奕迅/);
  assert.match(html, /教育背景/);
  assert.match(html, /实习经历/);
  assert.match(html, /项目经历/);
  assert.match(html, /技术技能/);
  assert.match(html, /荣誉奖项/);
  assert.match(html, /核心优势/);
  assert.match(html, /<strong>LLM<\/strong>/i);
  assert.match(html, /item-head/);
  assert.match(html, /item-body/);
  assert.ok(!html.includes("身份证") && !html.includes("薪资") && !html.includes("政治面貌"));
  assert.ok(!html.includes("#1d4ed8"), "简历不应使用蓝色加粗");
});

test("技能板块按 JD 关键词命中排序", () => {
  const sections = {
    education: [],
    internship: [],
    project: [],
    skills: ["熟悉 C++ 与嵌入式开发", "掌握 Java 服务端开发", "了解前端"],
    honors: [],
    other: []
  };
  const optimized = optimizeForJob(sections, { all: ["java"] });
  assert.match(optimized.skills[0], /Java/);
});

test("按 JD 关键词选择更匹配的简历版本，避免两份简历合并", () => {
  const facts = [
    { id: "ai", claim: "AI Agent 与 RAG 大模型应用，熟悉 LLM、Python、Agent 开发", source: "a.tex", status: "unverified" },
    { id: "adas", claim: "ADAS 标定与 LQR 控制，熟悉 C++、嵌入式、仿真", source: "b.tex", status: "unverified" }
  ];
  const best = selectBestFacts(facts, { all: ["llm", "rag", "agent"] });
  assert.equal(best.length, 1);
  assert.equal(best[0].id, "ai");
});

test("按 JD 方向选择基类简历版本：AI 岗不混入 ADAS 内容，双方向岗合并", () => {
  const facts = [
    { id: "ai", claim: "教育背景 示例大学 硕士。实习经历 博世：AI Agent 与 RAG 大模型应用，熟悉 LLM、Python、Agent 开发。", source: "agent_llm_general_2026.tex", status: "unverified" },
    { id: "adas", claim: "教育背景 示例大学 硕士。实习经历 博世：ADAS 标定与 LQR 控制，熟悉 C++、嵌入式、仿真。", source: "integration_adas_2026.tex", status: "unverified" },
    { id: "manual", claim: "荣誉与奖项 研究生期间获得校级二等奖学金。", source: "manual-confirm", status: "unverified" }
  ];
  const aiSel = selectBaseResumeFacts(facts, "岗位职责：负责 LLM 大模型应用与 RAG 智能问答系统开发，使用 Python 与 Agent。");
  assert.equal(aiSel.mode, "ai");
  assert.deepEqual(aiSel.facts.map((f) => f.id), ["ai", "manual"]);
  const adasSel = selectBaseResumeFacts(facts, "岗位职责：参与 ADAS 智驾标定，负责 LQR 参数匹配与实车验证。");
  assert.equal(adasSel.mode, "adas");
  assert.deepEqual(adasSel.facts.map((f) => f.id), ["adas", "manual"]);
  const bothSel = selectBaseResumeFacts(facts, "岗位职责：负责 LQR 控制参数匹配与 AI Agent 问答系统开发，使用 RAG。");
  assert.equal(bothSel.mode, "both");
  assert.equal(pickResumeMode("岗位职责：纯测试岗位，负责软硬件测试与缺陷跟踪。"), "both");
});

test("AI 岗生成聚焦简历：完整展开 AI 实习要点且不混入 ADAS 专属内容", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "applypkg-ai-"));
  const result = await generateApplicationPackage({
    job: {
      company_raw: "韶音科技",
      title_raw: "AI 应用工程师",
      jd_text: "岗位职责：负责大模型应用与智能体（Agent）开发，基于 RAG 构建企业知识问答系统，优化 LLM 推理效果；设计 Prompt 工程与结构化输出。任职要求：熟悉 Python、LLM、Agent、RAG，硕士及以上，2027届。",
      posting_url: "https://example.com/apply"
    },
    root: tmpRoot,
    polish: false
  });
  const html = fs.readFileSync(path.join(result.packagePath, "resume.html"), "utf8");
  const plain = html.replace(/<[^>]+>/g, "");
  assert.ok(plain.includes("多阶段问答流水线"), "AI 实习要点应完整保留");
  assert.ok(plain.includes("Recall@4"), "AI 实习要点应完整保留");
  assert.ok(plain.includes("白名单校验"), "AI 实习要点应完整保留");
  assert.ok(plain.includes("电磁与信号感知部门"), "霍莱沃新口径应完整保留");
  assert.ok(plain.includes("JSON Schema"), "AI 实习要点应完整保留");
  assert.ok(!plain.includes("参与 ADAS 控制参数的匹配与标定工作"), "不应混入 ADAS 专属实习要点");
  assert.ok(!plain.includes("ADAS 与系统集成"), "不应混入 ADAS 专属技能板块");
  assert.equal(result.qa.ok, true);
});

test("核心优势基于事实生成，无证据时不编造", () => {
  const sections = {
    internship: ["博世实习：AI Agent/RAG/LLM 应用 + ADAS 标定经验。"],
    project: ["飞艇项目：PPO/D3QN，以第一作者发表 SCI 论文。"],
    education: [],
    skills: [],
    honors: [],
    other: []
  };
  const lines = buildCoreHighlights(sections);
  assert.ok(lines.some((l) => l.includes("双方向")));
  assert.ok(lines.some((l) => l.includes("SCI")));
  assert.equal(buildCoreHighlights({ internship: [], project: [], education: [], skills: [], honors: [], other: [] }).length, 0);
});

test("两版简历合并：同公司实习保留两个角度，技能按主题合并", () => {
  const facts = [
    {
      id: "ai",
      claim: "实习经历 博世 (Bosch) · 苏州 2026.03 -- 至今 AI 应用开发实习生 ｜ 智驾匹配部门 设计并实现 AI Agent 问答系统。技术技能 大模型与 AI 应用：熟悉 LLM、RAG 与 Agent。",
      source: "a.tex",
      status: "unverified"
    },
    {
      id: "adas",
      claim: "实习经历 博世 (Bosch) · 苏州 2026.03 -- 至今 智驾匹配与标定实习生 参与 ADAS 控制参数标定。技术技能 ADAS 与系统集成：了解 L2 架构与标定流程。",
      source: "b.tex",
      status: "unverified"
    }
  ];
  const merged = mergeSectionsFromFacts(facts);
  assert.equal(merged.internship.length, 1);
  assert.ok(merged.internship[0].includes("AI 应用开发实习生") || merged.internship[0].includes("AI Agent"));
  assert.ok(merged.internship[0].includes("ADAS 控制参数标定"));
  assert.ok(merged.skills.some((s) => s.includes("LLM")));
  assert.ok(merged.skills.some((s) => s.includes("ADAS 与系统集成")));
});

test("荣誉奖项去重：与长条目重复的短条目不重复出现", () => {
  const facts = [
    { id: "ai", claim: "荣誉与奖项 荣誉奖学金 | 浙江省优秀毕业生、研究生期间校级二等奖学金 2022-2025", source: "a.tex", status: "unverified" },
    { id: "manual", claim: "荣誉与奖项 研究生期间获得校级二等奖学金。", source: "manual-confirm", status: "unverified" }
  ];
  const merged = mergeSectionsFromFacts(facts);
  assert.equal(merged.honors.filter((h) => h.includes("二等奖学金")).length, 1);
});

test("简历不含 LaTeX 残留且联系方式无括号嵌套", () => {
  const facts = loadFacts();
  const candidate = buildFormAnswers();
  const keywords = extractJobKeywords(job);
  const sections = classifyFacts(selectBestFacts(facts, keywords));
  const html = buildResumeHtml({ candidate, sections, keywords });
  assert.ok(!html.includes("[UTF8]") && !html.includes("[parsep") && !html.includes("ctex"));
  assert.ok(!html.includes("（RL（"));
  assert.ok(!html.includes("$$"));
  assert.ok(!html.includes("RL 方向"));
});

test("匹配报告包含要求对照、覆盖、真实缺口和未验证标注", () => {
  const facts = loadFacts();
  const candidate = buildFormAnswers();
  const keywords = extractJobKeywords(job);
  const sections = classifyFacts(selectBestFacts(facts, keywords));
  const report = buildMatchReport({ job, candidate, sections, keywords, facts });
  assert.match(report, /硬性要求/);
  assert.match(report, /硕士/);
  assert.match(report, /真实缺口/);
  assert.match(report, /未验证/);
  assert.match(report, /覆盖/);
});

test("表单答案只含安全字段", () => {
  const answers = buildFormAnswers();
  assert.equal(answers.name, "王奕迅");
  assert.equal(answers.email, "redacted@example.com");
  assert.equal(answers.phone, "13800000000");
  assert.equal(answers.university, "西安电子科技大学");
  assert.equal(answers.degree, "硕士");
  assert.match(answers.major, /控制科学与工程/);
  assert.equal(answers.graduation, "2027-06");
  const keys = Object.keys(answers);
  assert.ok(!keys.some((k) => /身份证|薪资|政治/.test(k)));
});

test("审计记录每条事实的来源、状态与包装决策", () => {
  const facts = loadFacts();
  const audit = buildAudit({ facts, job });
  assert.ok(audit.factsUsed.length >= 2);
  assert.ok(audit.factsUsed.every((f) => f.status === "unverified"));
  assert.ok(audit.packaging.length > 0);
  assert.equal(audit.jobId, job.id);
});

test("生成完整申请包：6 个文件齐全且 PDF 非空", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "applypkg-"));
  const result = await generateApplicationPackage({ job, root: tmpRoot, polish: false });
  const files = fs.readdirSync(result.packagePath).sort();
  assert.deepEqual(files, [
    "form-answers.json",
    "generation-audit.json",
    "job-description.md",
    "match-report.md",
    "resume.html",
    "resume.pdf"
  ]);
  const pdfSize = fs.statSync(path.join(result.packagePath, "resume.pdf")).size;
  assert.ok(pdfSize > 1000);
  assert.equal(result.qa.ok, true);
});

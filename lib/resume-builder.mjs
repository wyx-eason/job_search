import fs from "node:fs";
import path from "node:path";
import { loadCandidateAutofill } from "./apply-assistant.mjs";
import { buildTailoredHighlights } from "./jd-tailor.mjs";

const root = path.resolve(import.meta.dirname, "..");

const SECTION_MARKERS = [
  ["教育背景", "education"],
  ["实习经历", "internship"],
  ["项目经历", "project"],
  ["技术技能", "skills"],
  ["荣誉与奖项", "honors"]
];

const SKILL_LEXICON = [
  "python", "c++", "java", "go", "llm", "rag", "agent", "pytorch", "tensorflow", "ros", "linux", "git",
  "docker", "kubernetes", "mysql", "redis", "嵌入式", "控制", "算法", "自动驾驶", "adas", "仿真", "标定",
  "测试", "机器人", "大模型", "深度学习", "强化学习", "机器学习", "自然语言", "计算机视觉", "规划", "感知",
  "融合", "硬件", "fpga", "ic", "电力电子", "机械", "结构", "电气", "自动化", "通信", "安全", "数据", "sql",
  "cuda", "opencv", "qt", "微服务", "容器", "多传感器"
];

const DIRECTION_LEXICONS = {
  ai: [
    "llm", "rag", "agent", "大模型", "自然语言", "深度学习", "机器学习", "强化学习",
    "多模态", "nlp", "prompt", "embedding", "微调", "模型训练", "ai 应用", "智能问答", "智能体", "推理"
  ],
  adasStrong: ["adas", "智驾", "自动驾驶", "标定", "无人车", "底盘", "域控", "传感器融合"],
  adas: ["lqr", "mpc", "定位", "转向", "制动", "车辆", "汽车", "v模型", "iso 26262", "功能安全", "can"]
};

export function scoreJobDirection(jdText) {
  const text = String(jdText || "").toLowerCase();
  const count = (terms) => terms.filter((term) => text.includes(term)).length;
  return {
    ai: count(DIRECTION_LEXICONS.ai),
    adas: count(DIRECTION_LEXICONS.adasStrong) * 2 + count(DIRECTION_LEXICONS.adas)
  };
}

export function pickResumeMode(jdText) {
  const { ai, adas } = scoreJobDirection(jdText);
  if (ai > 0 && adas === 0) return "ai";
  if (adas > 0 && ai === 0) return "adas";
  if (ai > 0 && adas > 0) {
    if (ai >= 3 && ai >= adas * 2) return "ai";
    if (adas >= 3 && adas >= ai * 2) return "adas";
    return "both";
  }
  // 两个方向都没有信号（如管培生/纯测试岗）：不合并两份基类，
  // 由 selectBaseResumeFacts 按 JD 重合度挑一份，避免内容重复混杂
  return "auto";
}

export function selectBaseResumeFacts(facts, jdText) {
  const mode = pickResumeMode(jdText);
  const bases = facts.filter((f) => f.claim.includes("教育背景") && f.claim.includes("实习经历"));
  const aiBase = bases.filter((f) => /agent_llm|general/i.test(f.source));
  const adasBase = bases.filter((f) => /adas/i.test(f.source));
  const manual = facts.filter((f) => /manual-confirm/i.test(f.source));
  let chosen;
  if (mode === "ai") chosen = aiBase;
  else if (mode === "adas") chosen = adasBase;
  else if (mode === "auto") {
    const overlap = (base) => {
      const tokens = new Set(String(jdText || "").toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/g) || []);
      let hits = 0;
      for (const token of tokens) if (base.claim.toLowerCase().includes(token)) hits++;
      return hits;
    };
    const aiScore = aiBase.reduce((sum, b) => sum + overlap(b), 0);
    const adasScore = adasBase.reduce((sum, b) => sum + overlap(b), 0);
    chosen = aiScore >= adasScore ? (aiBase.length ? aiBase : adasBase) : (adasBase.length ? adasBase : aiBase);
  } else {
    chosen = [...aiBase, ...adasBase];
  }
  if (!chosen.length) chosen = bases.length ? [bases[0]] : facts;
  const extra = manual.filter((m) => !chosen.some((c) => c.id === m.id));
  return { mode, facts: [...chosen, ...extra] };
}

export function loadFacts(base = root) {
  const yml = fs.readFileSync(path.join(base, "candidate/facts.yml"), "utf8");
  const ids = [...yml.matchAll(/^\s*- id:\s*(\S+)$/gm)].map((m) => m[1]);
  const claims = [...yml.matchAll(/claim:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const sources = [...yml.matchAll(/^\s*source:\s*(\S+)$/gm)].map((m) => m[1]);
  const statuses = [...yml.matchAll(/^\s*status:\s*(\S+)$/gm)].map((m) => m[1]);
  return claims.map((claim, i) => ({
    id: ids[i] || `fact-${i + 1}`,
    type: "claim",
    claim,
    source: sources[i] || "",
    status: statuses[i] || "unverified"
  }));
}

function cleanItem(text) {
  return String(text)
    .replace(/\\/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:itemize|document|resume|UTF8|ctex|linespacing_fix|cite|hidelinks|gobble)\b/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\$\$/g, "/")
    .replace(/[（(]\s*RL[^）)]*[）)]/g, "")
    .replace(/([\u4e00-\u9fa5])(\d{4}\.\d{2})/g, "$1 $2")
    .replace(/([\u4e00-\u9fa5])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([\u4e00-\u9fa5])/g, "$1 $2")
    .replace(/([\u4e00-\u9fa5])(\d)/g, "$1 $2")
    .replace(/\(\s*$/g, "")
    .replace(/\((?=[^()]*$)/, "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
}

function groupBullets(items) {
  const out = [];
  const isHeader = (line) => /(20\d{2}\.\d{2}\s*--\s*(20\d{2}\.\d{2}|至今)|至今)/.test(line);
  for (const line of items) {
    if (isHeader(line) || !out.length) {
      out.push(line);
    } else {
      out[out.length - 1] += `${out[out.length - 1].endsWith("。") ? "" : "。"}${line}`;
    }
  }
  return out;
}

export function selectBestFacts(facts, keywords) {
  if (!facts.length) return [];
  const terms = (keywords.all || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const scored = facts
    .map((fact) => ({ fact, hits: terms.filter((t) => fact.claim.toLowerCase().includes(t)).length }))
    .sort((a, b) => b.hits - a.hits);
  return [scored[0].fact];
}

function splitResumeSentences(item) {
  return String(item || "")
    .split(/(?<=[。；;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mergeSectionsFromFacts(facts) {
  const sets = facts.map((fact) => classifyFacts([fact]));
  const normalizeDedupe = (sentences) => {
    const seen = new Set();
    const out = [];
    for (const sentence of sentences) {
      const norm = sentence.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(sentence);
      }
    }
    return out;
  };
  const mergeGroup = (items, keyFn, skipHeaderOfRest = true) => {
    const stripLeadingHeader = (sentence) => {
      let s = String(sentence).replace(/^[\u4e00-\u9fa5A-Za-z（）()·|｜\s]+?20\d{2}\.\d{2}\s*--\s*(?:20\d{2}\.\d{2}|至今)/, "");
      const bar = s.search(/[｜|]/);
      if (bar >= 0 && bar < 30) s = s.slice(bar + 1);
      return s.trim();
    };
    const groups = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const out = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        out.push(group[0]);
        continue;
      }
      const sentences = [];
      for (const [index, item] of group.entries()) {
        const parts = splitResumeSentences(item);
        const candidates =
          index === 0 || !skipHeaderOfRest ? parts : parts.map(stripLeadingHeader).filter(Boolean);
        sentences.push(...candidates);
      }
      out.push(normalizeDedupe(sentences).join(""));
    }
    return out;
  };
  const headKey = (item) => (splitResumeSentences(item)[0] || item).slice(0, 8);
  const skillKey = (item) => (String(item).match(/^([^：:]{2,14})[：:]/) || [null, String(item).slice(0, 6)])[1];
  const SKILL_LABELS = ["大模型与 AI 应用", "AI 算法与强化学习", "编程语言与工具", "工程素养", "ADAS 与系统集成", "控制与规划算法", "数据处理与融合"];
  const splitSkillTopics = (items) => {
    const topics = [];
    for (const item of items) {
      const pattern = new RegExp(`(?=(?:${SKILL_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[：:])`, "g");
      const parts = String(item).split(pattern).map((s) => s.trim()).filter(Boolean);
      topics.push(...(parts.length ? parts : [item]));
    }
    return topics;
  };
  const mergeSkills = (items) => {
    const groups = new Map();
    for (const item of items) {
      const key = skillKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const out = [];
    for (const [key, group] of groups) {
      if (group.length === 1) {
        out.push(group[0]);
        continue;
      }
      const labelRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[：:]`);
      const fragments = [];
      for (const item of group) {
        for (const sentence of splitResumeSentences(String(item).replace(labelRe, ""))) {
          if (!fragments.includes(sentence)) fragments.push(sentence);
        }
      }
      out.push(`${key}：${fragments.join("")}`);
    }
    return out;
  };
  const dedupeHonors = (items) => {
    const norm = (s) =>
      String(s)
        .replace(/[。，、|｜（）()\s]/g, "")
        .replace(/获得/g, "")
        .replace(/20\d{2}(?:-20\d{2})?/g, "");
    const kept = [];
    for (const item of items) {
      const n = norm(item);
      if (!n) continue;
      if (kept.some((k) => norm(k).includes(n))) continue;
      kept.push(item);
    }
    return kept;
  };
  return {
    education: normalizeDedupe(sets.flatMap((s) => s.education)),
    internship: mergeGroup(sets.flatMap((s) => s.internship), headKey),
    project: mergeGroup(sets.flatMap((s) => s.project), headKey),
    skills: mergeSkills(splitSkillTopics(sets.flatMap((s) => s.skills))),
    honors: dedupeHonors(sets.flatMap((s) => s.honors)),
    other: []
  };
}

export function classifyFacts(facts) {
  const text = facts
    .map((f) => f.claim)
    .join("\n")
    .replace(/\\item\s*/g, "\n")
    .replace(/\bitemize\b/g, "\n")
    .replace(/\\/g, "\n")
    .replace(/\n{2,}/g, "\n");
  const sections = { education: [], internship: [], project: [], skills: [], honors: [], other: [] };
  const positions = SECTION_MARKERS.map(([name, key]) => ({ name, key, index: text.indexOf(name) }))
    .filter((p) => p.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (!positions.length) {
    sections.other.push(cleanItem(text));
    return sections;
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].name.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    const items = text
      .slice(start, end)
      .split("\n")
      .map(cleanItem)
      .filter((s) => s);
    const key = positions[i].key;
    sections[key].push(...(key === "internship" || key === "project" ? groupBullets(items) : items));
  }
  return sections;
}

export function extractJobKeywords(job) {
  const text = `${job.title_raw || ""} ${job.jd_text || ""}`.toLowerCase();
  const degree = ["博士", "硕士", "本科"].find((d) => text.includes(d)) || "";
  const matched = SKILL_LEXICON.filter((k) => text.includes(k.toLowerCase()));
  const all = [...new Set([degree ? `${degree}学历` : "", ...matched])].filter(Boolean);
  return { required: all, all };
}

export function buildFormAnswers() {
  return loadCandidateAutofill();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function highlight(text, keywords) {
  let out = esc(text);
  const sorted = [...(keywords || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const keyword of sorted) {
    const pattern = new RegExp(esc(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(pattern, (m) => `<strong>${m}</strong>`);
  }
  return out;
}

const SECTION_TITLES = {
  education: "教育背景",
  internship: "实习经历",
  project: "项目经历",
  skills: "技术技能",
  honors: "荣誉奖项"
};

function splitSentences(text) {
  return String(text)
    .split(/(?<=[。！？!?；;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function optimizeItem(item, terms, maxLength) {
  const sentences = splitSentences(item);
  if (sentences.length <= 2) return item.slice(0, maxLength).trim();
  const head = sentences[0];
  const rest = sentences
    .slice(1)
    .map((s, index) => ({ s, index, hits: terms.filter((t) => s.toLowerCase().includes(t)).length }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((x) => x.s);
  let out = head;
  for (const sentence of rest) {
    if (out.length >= maxLength) break;
    out += sentence;
  }
  return out.trim();
}

export function optimizeForJob(sections, keywords) {
  const terms = (keywords.all || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const compress = (list, max) => list.map((item) => optimizeItem(item, terms, max)).filter(Boolean);
  const skills = [...(sections.skills || [])]
    .map((item) => ({ item, hits: terms.filter((t) => item.toLowerCase().includes(t)).length }))
    .sort((a, b) => b.hits - a.hits)
    .map((x) => optimizeItem(x.item, terms, 180));
  return {
    education: sections.education || [],
    // 经历板块保留完整要点，只按 JD 相关性重排句子，避免把对口经历截断
    internship: compress(sections.internship || [], 900),
    project: compress(sections.project || [], 700),
    skills,
    honors: (sections.honors || [])
      .flatMap((h) =>
        String(h)
          .split(/(?=核心竞赛|荣誉奖学金|基础学科)/)
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => part.slice(0, 65))
      )
      .filter(Boolean),
    other: []
  };
}

export function buildCoreHighlights(sections) {
  const safe = sections || {};
  const internship = ["internship"].flatMap((k) => safe[k] || []).join(" ");
  const project = ["project"].flatMap((k) => safe[k] || []).join(" ");
  const parts = [];
  if (/(AI Agent|RAG|LLM)/.test(internship) && /(ADAS|标定|智驾)/.test(internship)) {
    parts.push("AI 应用（Agent/RAG/LLM）与 ADAS 智驾匹配标定双方向经验");
  } else if (/(AI Agent|RAG|LLM)/.test(internship)) {
    parts.push("AI 应用落地经验（Agent/RAG/LLM）");
  }
  if (/(SCI|论文|第一作者)/.test(project)) {
    parts.push("硕士独立完成强化学习仿真系统，SCI 论文第一作者");
  } else if (/(强化学习|PPO|飞艇)/.test(project)) {
    parts.push("硕士独立完成强化学习仿真系统（PPO/D3QN）");
  }
  return parts.length ? [parts.join("；")] : [];
}

export function buildResumeHtml({ candidate, sections, keywords, job }) {
  const optimized = optimizeForJob(sections, keywords);
  const majorClean = String(candidate.major || "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[（(][^）)]*$/g, "")
    .trim();
  const blocks = SECTION_MARKERS.map(([, key]) => {
    const items = (optimized[key] || []).filter(Boolean);
    if (!items.length) return "";
    const listItems = items
      .map((item) => {
        if (key === "honors") {
          const parts = String(item)
            .split(/(?=核心竞赛|荣誉奖学金|基础学科)/)
            .map((part) => part.trim())
            .filter(Boolean);
          return (parts.length ? parts : [item]).map((part) => `  <li>${highlight(part, keywords.all)}</li>`).join("\n");
        }
        if (key === "internship" || key === "project") {
          const sentences = splitResumeSentences(item);
          const head = sentences[0] || item;
          const body = sentences.slice(1).join("");
          return `  <li><div class="item-head">${highlight(head, keywords.all)}</div>${body ? `<div class="item-body">${highlight(body, keywords.all)}</div>` : ""}</li>`;
        }
        return `  <li>${highlight(item, keywords.all)}</li>`;
      })
      .join("\n");
    return `<h2>${SECTION_TITLES[key]}</h2>\n<ul>\n${listItems}\n</ul>`;
  }).filter(Boolean);
  const target = job?.title_raw ? `<p class="target">应聘岗位：${esc(job.title_raw)}</p>` : "";
  const core = buildCoreHighlights(sections);
  const coreHtml = core.length
    ? `<h2>核心优势</h2>\n<ul>\n${core.map((line) => `  <li>${highlight(line, keywords.all)}</li>`).join("\n")}\n</ul>`
    : "";
  let highlightsHtml = "";
  if (job?.jd_text && String(job.jd_text).trim().length >= 80) {
    const highlights = buildTailoredHighlights({ jdText: job.jd_text, sections, keywords, maxItems: 2 });
    if (highlights.length) {
      highlightsHtml = `<h2>岗位匹配亮点</h2>\n<ul>\n${highlights.map((h) => `  <li>${highlight(h.line, keywords.all)}</li>`).join("\n")}\n</ul>`;
    }
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(candidate.name)} - 简历</title>
<style>
  @page { size: A4; margin: 13mm 15mm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; font-size: 9.5pt; line-height: 1.3; color: #1a1a1a; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 2px; letter-spacing: 1px; }
  .contact { color: #444; font-size: 9.5pt; margin: 0 0 4px; }
  .target { font-size: 9.5pt; margin: 0 0 8px; border-left: 2px solid #999; padding-left: 6px; color: #333; }
  h2 { font-size: 10.5pt; margin: 6px 0 2px; border-bottom: 1px solid #999; padding-bottom: 1px; letter-spacing: .5px; }
  ul { margin: 0; padding-left: 16px; }
  li { margin: 0.5px 0; }
  .item-head { font-weight: 600; }
  .item-body { margin-top: 1px; }
  strong { font-weight: 700; }
</style>
</head>
<body>
<h1>${esc(candidate.name)}</h1>
<p class="contact">电话：${esc(candidate.phone)} ｜ 邮箱：${esc(candidate.email)} ｜ ${esc(candidate.university)} · ${esc(majorClean)}（${esc(candidate.degree)}，${esc(candidate.graduation)}）</p>
${target}
${coreHtml}
${highlightsHtml}
${blocks.join("\n")}
</body>
</html>
`;
}

export function buildMatchReport({ job, candidate, sections, keywords, facts = [] }) {
  const allText = [candidate.name, ...Object.values(sections).flat()].join(" ").toLowerCase();
  const coverage = keywords.all.map((keyword) => {
    const needle = keyword.replace(/学历$/, "").toLowerCase();
    return { keyword, covered: allText.includes(needle) };
  });
  const coveredCount = coverage.filter((c) => c.covered).length;
  const gaps = coverage.filter((c) => !c.covered).map((c) => c.keyword);
  const degreeReq = keywords.all.find((k) => k.includes("学历")) || "";
  const degreeOk = degreeReq
    ? (candidate.degree || "").includes(degreeReq.replace("学历", ""))
      ? "已满足"
      : "未满足"
    : "无法判定";
  const lines = [
    `# 匹配报告 - ${job.company_raw} - ${job.title_raw}`,
    "",
    `- 投递链接：${job.posting_url || "无"}`,
    `- 生成时间：${new Date().toISOString().slice(0, 10)}`,
    "",
    "## 硬性要求对照",
    "",
    `- 学历要求：${degreeReq || "未识别"} → 候选人：${candidate.degree || "未知"}（${candidate.university || "未知"}，${candidate.graduation || "未知"}）——${degreeOk}`,
    "",
    `## JD 关键词覆盖（${coveredCount}/${coverage.length}）`,
    "",
    "| 关键词 | 覆盖 |",
    "|---|---|",
    ...coverage.map((c) => `| ${c.keyword} | ${c.covered ? "✅" : "❌"} |`),
    "",
    "## 真实缺口",
    "",
    gaps.length ? gaps.map((g) => `- ${g}`).join("\n") : "- 无重大缺口",
    "",
    "## 事实验证状态",
    "",
    "以下事实条目来自简历草稿，状态为未验证（unverified），投递前请逐条核对（教育与联系方式尤其重要）：",
    ...facts.map((f) => `- ${f.id}（${f.source}）：${f.status === "unverified" ? "未验证" : f.status}`),
    ""
  ];
  return lines.join("\n");
}

export function buildAudit({ facts, job, sections, keywords, verifiedOnly = false, jdSource = null, qa = null, mode = "both", polish = null }) {
  const sectionOf = (claim) => SECTION_MARKERS.find(([name]) => claim.includes(name))?.[1] || "other";
  return {
    generatedAt: new Date().toISOString(),
    jobId: job?.id || null,
    company: job?.company_raw || "",
    title: job?.title_raw || "",
    jdSource,
    polish,
    verifiedOnly,
    factsUsed: facts.map((f) => ({
      id: f.id,
      source: f.source,
      status: f.status,
      section: sectionOf(f.claim)
    })),
    packaging: [
      `按 JD 方向选择基类简历版本（${mode}）`,
      "板块顺序按岗位相关性调整",
      "JD 关键词在简历中突出显示",
      "未新增任何公司、头衔、时间、数字、奖项或论文状态"
    ],
    coreHighlights: buildCoreHighlights(sections),
    highlights:
      job?.jd_text && String(job.jd_text).trim().length >= 80 && keywords
        ? buildTailoredHighlights({ jdText: job.jd_text, sections, keywords })
        : [],
    note: verifiedOnly
      ? "严格模式：仅使用已验证事实"
      : "默认模式包含 unverified 事实，投递前请核对 match-report.md",
    qa
  };
}

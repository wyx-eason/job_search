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

export function splitEntry(item) {
  const sentences = splitSentences(item);
  const head = sentences[0] || "";
  const date = extractDate(head);
  let roleLine = "";
  let techLine = "";
  const bullets = [];
  for (const sentence of sentences.slice(1)) {
    const s = sentence.replace(/[。]$/, "").trim();
    if (/^技术[:：]/.test(s)) {
      if (!techLine) techLine = s;
    } else if (/[｜|]/.test(s) && s.length <= 150 && !roleLine) {
      roleLine = s;
    } else {
      bullets.push(s);
    }
  }
  return { head, date, roleLine, techLine, bullets };
}

export function sanitizeEntryHead(newTitle, originalHead) {
  const t = String(newTitle || "").trim().replace(/[。]$/, "");
  if (!DATE_RE.test(t)) return originalHead;
  const left = stripDateAndPunct(originalHead);
  if (left && !t.includes(left)) return originalHead;
  return t;
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
  const parts = String(line || "").split(/[｜|]\s*/).map((s) => s.trim()).filter(Boolean);
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
  const { head, date, roleLine, techLine, bullets } = splitEntry(item);
  if (!head) return "";
  let roleRow = "";
  if (roleLine) {
    const { role, dept, tech } = splitRoleLine(roleLine);
    roleRow = `<div class="role-row"><span class="role">${highlight([role, dept].filter(Boolean).join(" | "), keywords)}</span>${tech ? `<span class="tech">${highlight(tech, keywords)}</span>` : ""}</div>`;
  }
  const techRow = techLine ? `<div class="tech-row">${highlight(techLine.replace(/^技术[:：]\s*/, ""), keywords)}</div>` : "";
  const bulletsHtml = bullets.length ? `<ul class="entry">${bullets.map((b) => `<li>${highlight(b, keywords)}</li>`).join("")}</ul>` : "";
  return `${renderDatedRow(stripDateAndPunct(head), date, keywords)}${roleRow}${techRow}${bulletsHtml}`;
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
  @page { size: A4; margin: 13mm 14mm; }
  body { font-family: "Times New Roman", SimSun, "Songti SC", serif; font-size: 10pt; line-height: 1.34; color: #111; margin: 0; }
  h1 { font-size: 17pt; text-align: center; margin: 0 0 3px; letter-spacing: 1px; }
  .contact { text-align: center; color: #444; font-size: 10pt; margin: 0 0 8px; }
  h2 { font-size: 11.5pt; margin: 11px 0 3px; padding-bottom: 2px; border-bottom: 1px solid #999; letter-spacing: .5px; }
  .dated-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px; }
  .dated-row .left { font-weight: 600; }
  .dated-row .date { color: #555; font-size: 9.5pt; white-space: nowrap; }
  .detail { margin-top: 1px; }
  .role-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 1px; }
  .role-row .role { font-style: italic; }
  .role-row .tech { color: #666; font-size: 9.5pt; text-align: right; }
  .tech-row { color: #666; font-size: 9.5pt; margin-top: 1px; }
  ul.entry { margin: 3px 0 0; padding-left: 18px; }
  ul.entry li { margin: 0.5px 0; }
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

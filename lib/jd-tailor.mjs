function splitSentences(segment) {
  return String(segment || "")
    .split(/(?<=[。；;！？!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

export function extractJdPoints(jdText) {
  const text = String(jdText || "");
  const dutyStart = text.search(/(岗位职责|职位描述|工作职责|岗位描述)/);
  const reqStart = text.search(/(任职要求|职位要求|岗位要求)/);
  const duties = [];
  const requirements = [];
  if (dutyStart >= 0) {
    const seg = text.slice(dutyStart, reqStart > dutyStart ? reqStart : dutyStart + 1200);
    duties.push(...splitSentences(seg));
  }
  if (reqStart >= 0) {
    requirements.push(...splitSentences(text.slice(reqStart, reqStart + 900)));
  }
  return { duties, requirements };
}

export function buildTailoredHighlights({ jdText, sections, keywords, maxItems = 4 }) {
  const { duties, requirements } = extractJdPoints(jdText);
  const points = [...duties, ...requirements].filter((p) => p.length <= 80);
  const terms = (keywords.all || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const pool = [];
  for (const key of ["internship", "project", "skills"]) {
    for (const item of sections[key] || []) {
      for (const sentence of splitSentences(item)) pool.push({ sentence, hits: terms.filter((t) => sentence.toLowerCase().includes(t)).length });
    }
  }
  const highlights = [];
  const used = new Set();
  for (const point of points) {
    if (highlights.length >= maxItems) break;
    const pointTerms = terms.filter((t) => point.toLowerCase().includes(t));
    if (!pointTerms.length) continue;
    let best = null;
    let bestScore = 0;
    for (const evidence of pool) {
      if (used.has(evidence.sentence)) continue;
      const score = pointTerms.filter((t) => evidence.sentence.toLowerCase().includes(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = evidence;
      }
    }
    if (best && bestScore > 0) {
      used.add(best.sentence);
      const brief =
        point
          .replace(/^(岗位职责|职位描述|工作职责|岗位描述|任职要求|职位要求|岗位要求|岗位定位|工作内容)[:：]?\s*/, "")
          .replace(/^[0-9、\s.（）()]+/, "")
          .trim()
          .slice(0, 20);
      const briefText = brief.length >= 20 ? `${brief}…` : brief;
      highlights.push({ jdPoint: briefText, evidence: best.sentence, line: `针对「${briefText}」：${best.sentence}` });
    }
  }
  return highlights;
}

export function runResumeQa({ html, candidate, keywords, pdfSize = 0 }) {
  const issues = [];
  const warnings = [];
  const text = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
  const checks = {
    个人信息: () => Boolean(candidate?.name && text.includes(candidate.name)),
    联系方式: () => Boolean(candidate?.phone && text.includes(candidate.phone)),
    教育背景: () => text.includes("教育背景"),
    经历板块: () => text.includes("实习经历") || text.includes("项目经历"),
    "LaTeX 残留": () => !/\\[a-zA-Z]+|itemize|\\u0026|\b(document|ctex|UTF8|linespacing)\b/.test(String(html || "")),
    敏感字段泄露: () => !/(身份证|政治面貌|期望薪资|详细地址|验证码|密码)/.test(text),
    乱码字符: () => !/[\uFFFD]/.test(text)
  };
  for (const [name, check] of Object.entries(checks)) {
    if (!check()) issues.push(name);
  }
  const all = (keywords?.all || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const covered = all.filter((k) => text.toLowerCase().includes(k));
  if (all.length && covered.length === 0) issues.push("简历未命中任何 JD 关键词");
  if (pdfSize && pdfSize < 5000) issues.push("PDF 异常偏小");
  const textLength = text.length;
  if (textLength > 3200) warnings.push(`正文偏长（${textLength} 字符），可能超过一页`);
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    coveredKeywords: covered.length,
    totalKeywords: all.length
  };
}

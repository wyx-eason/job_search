export function urlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    const hash = parsed.hash.split("?")[0].replace(/\/apply$/, "").replace(/\/$/, "");
    return `${parsed.host}${parsed.pathname}${hash}`;
  } catch {
    return String(url || "");
  }
}

export function shouldAutoRegenerate({ lastRegen, jdText, url, requireMarkers = true, force = false }) {
  const text = String(jdText || "").trim();
  if (!force && requireMarkers && !/(岗位职责|任职要求|职位描述|工作职责)/.test(text)) {
    return { ok: false, reason: "当前页面不是具体岗位详情，未重新生成" };
  }
  const norm = text.replace(/\s+/g, "");
  if (!norm) return { ok: false, reason: "页面未提取到有效 JD 内容" };
  if (force) return { ok: true };
  if (norm.length < 50) return { ok: false, reason: "页面未提取到有效 JD 内容" };
  if (lastRegen && lastRegen.jdTextNorm === norm) {
    return { ok: false, reason: "JD 未变化，未重复生成" };
  }
  // 同 URL 但 JD 内容已变化（如 SPA 内切换岗位）：允许重新生成
  return { ok: true };
}

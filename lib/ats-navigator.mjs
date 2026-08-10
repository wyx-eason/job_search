import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

function loadAtsPreferences() {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(projectRoot, "candidate/preferences.json"), "utf8"));
    return [...(prefs.targets?.primary || []), ...(prefs.targets?.local_broad || [])]
      .map((term) => String(term).toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scoreCard(text, terms) {
  const lower = String(text).toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

export function detectAts(url) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("mokahr.com")) return "mokahr";
    if (host.includes("jobs.feishu.cn") || host.includes("mioffice") || host === "we.zyt.com") return "feishu";
    if (host.endsWith("zhiye.com")) return "zhiye";
  } catch {
    // 忽略无法解析的 URL
  }
  return null;
}

const CATEGORY_SUFFIX = /(类|板块|方向|等|计划|工程|技术)$/;

export function pickKeyword(job) {
  const title = (job?.title_raw || job?.title || "").trim();
  const tokens = title.split(/[、，,;；/｜|\s]+/).map((t) => t.trim()).filter(Boolean);
  const raw = tokens.find((t) => !CATEGORY_SUFFIX.test(t)) || tokens[0] || "";
  const cleaned = raw.replace(CATEGORY_SUFFIX, "").trim();
  if (cleaned) return cleaned.slice(0, 10);
  const company = (job?.company_raw || job?.company || "").trim();
  return (company.split(/\s+/)[0] || "").slice(0, 10);
}

export function hasSingleRole(job) {
  const title = (job?.title_raw || job?.title || "").trim();
  const tokens = title.split(/[、，,;；/｜|]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.length <= 1;
}

export function shouldDeferResume(job, applyUrl) {
  // 多方向汇总岗位：先不生成简历，等选定具体岗位后再按真实 JD 生成
  return !hasSingleRole(job);
}

export function cleanJobTitleForFileName(title) {
  const junk = /(教育背景|实习经历|项目经历|技术技能|荣誉奖项|岗位职责|职位描述|任职要求|发布时间|发布日期|发布于|是否支持外推|校招面试站点|职位信息)/;
  const text = String(title || "").replace(/^【[^】]*】/, "").trim();
  const cut = text.search(junk);
  const clean = cut === 0 ? "" : cut > 0 ? text.slice(0, cut) : text;
  const normalized = clean.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_").replace(/^_+|_+$/g, "");
  const tokens = normalized
    .split("_")
    .filter((token) => token && !/(类|等)$/.test(token) && !(token.length <= 4 && /(板块|方向)$/.test(token)));
  return tokens.join("_").slice(0, 30);
}

const JOB_LINK_RE = {
  mokahr: /#\/job\//,
  feishu: /\/position\/\d+\/detail/,
  zhiye: /job|position/i
};

async function findSearchInput(page) {
  const inputs = page.locator("input:visible");
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const placeholder = (await inputs.nth(i).getAttribute("placeholder").catch(() => "")) || "";
    if (/职位|搜索|关键字|关键词/.test(placeholder)) return inputs.nth(i);
  }
  return null;
}

async function collectJobCards(page, ats, keyword) {
  const links = page.locator("a:visible");
  const count = await links.count().catch(() => 0);
  const re = JOB_LINK_RE[ats];
  const matches = [];
  for (let i = 0; i < count; i++) {
    const el = links.nth(i);
    const href = (await el.getAttribute("href").catch(() => "")) || "";
    const text = ((await el.textContent().catch(() => "")) || "").trim();
    if (re && !re.test(href)) continue;
    if (keyword && !text.includes(keyword)) continue;
    matches.push(el);
  }
  return matches;
}

export function isJobDetailUrl(url, ats = detectAts(url)) {
  if (ats === "mokahr") return /#\/job\//.test(url);
  if (ats === "feishu") return /\/position\/\d+\/detail/.test(url);
  if (ats === "zhiye") return /(job|position)\/(detail|view)/i.test(url);
  return false;
}

export function looksLikeJobDetailText(text) {
  return /(岗位职责|职位描述|工作职责|任职要求)/.test(String(text || ""));
}

async function clickApplyButton(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidates = page.locator("button:visible, [role=button]:visible, a:visible, span:visible, div:visible");
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const text = ((await candidates.nth(i).textContent().catch(() => "")) || "").trim();
      if (/立即投递|投递简历|去投递|申请职位|^申请$/.test(text) && text.length <= 8) {
        await candidates.nth(i).click().catch(() => {});
        return true;
      }
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

export async function navigateToApply(page, job, options = {}) {
  const log = [];
  const ats = options.ats || detectAts(page.url());
  if (!ats) return { matched: false, log: [...log, "未知招聘系统，跳过自动导航"] };
  log.push(`识别为 ${ats} 招聘系统`);
  if (isJobDetailUrl(page.url(), ats)) {
    return { matched: true, log: [...log, "页面已是具体岗位，等待申请表单"] };
  }
  const keyword = pickKeyword(job);
  if (!hasSingleRole(job)) {
    return {
      matched: false,
      log: [...log, "公司级汇总行（多方向），已跳过自动搜索和自动选岗，请自行搜索并选择岗位；选定后助手会自动填写并按当前岗位重新生成简历"]
    };
  }
  log.push(keyword ? `搜索关键词：${keyword}` : "无可用关键词，直接查找岗位");
  const search = await findSearchInput(page);
  if (!search) return { matched: false, log: [...log, "未找到搜索框，请手动选择岗位"] };
  if (keyword) {
    await search.fill(keyword).catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(2500);
  }
  const cards = await collectJobCards(page, ats, keyword);
  if (cards.length === 0) return { matched: false, log: [...log, "未找到匹配岗位，请手动选择"] };
  let card = null;
  let cardText = "";
  if (cards.length === 1) {
    card = cards[0];
  } else {
    const terms = options.preferences || loadAtsPreferences();
    const scored = [];
    for (const el of cards) {
      const text = ((await el.textContent().catch(() => "")) || "").trim();
      scored.push({ el, text, score: scoreCard(text, terms) });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const uniqueBest = best.score > 0 && scored.filter((s) => s.score === best.score).length === 1;
    if (uniqueBest) {
      card = best.el;
      cardText = best.text;
      log.push(`多个匹配，按目标方向偏好（命中 ${best.score} 项）自动选择：${best.text.slice(0, 30)}`);
    } else {
      const related = scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.text.slice(0, 24));
      return {
        matched: false,
        log: [...log, `搜索“${keyword}”找到 ${cards.length} 个匹配岗位${related.length ? `，偏好相关：${related.join("；")}` : ""}，无法唯一确定，请手动选择后点击"申请职位"`]
      };
    }
  }
  cardText = cardText || ((await card.textContent().catch(() => "")) || "").trim().slice(0, 30);
  await card.click().catch(() => {});
  log.push(`已打开岗位：${cardText}`);
  await page.waitForTimeout(2500);
  const applied = await clickApplyButton(page);
  if (!applied) return { matched: true, log: [...log, "未找到投递按钮，请手动点击"] };
  log.push("已点击立即投递，等待申请表单…");
  await page.waitForTimeout(2500);
  return { matched: true, log };
}

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { navigateToApply } from "./ats-navigator.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

export function extractJdFromPageText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const dutyIndex = joined.search(/(岗位职责|职位描述|工作职责)/);
  if (dutyIndex < 0) {
    const reqIndex = joined.search(/(任职要求|职位要求|岗位要求)/);
    return reqIndex < 0 ? joined.slice(0, 1200).trim() : joined.slice(reqIndex, reqIndex + 900).trim();
  }
  let chunk = joined.slice(dutyIndex);
  const reqIndex = chunk.search(/(任职要求|职位要求|岗位要求)/);
  chunk = reqIndex > 0 ? chunk.slice(0, reqIndex + 900) : chunk.slice(0, 1600);
  const cut = chunk.search(/(申请职位|立即投递|投递简历|上传简历|基本信息|个人信息|我的简历|简历附件|推荐码|首页\/|相关职位|公司简介|公司信息|©|版权所有|友情链接)/);
  if (cut > 0) chunk = chunk.slice(0, cut);
  return chunk.trim();
}

function cleanTitle(title) {
  return String(title).replace(/^【[^】]*】/, "").trim().slice(0, 60);
}

function cutAtLabels(text) {
  const cut = String(text).search(/(是否支持|外推|发布时间|发布日期|职位名称|岗位名称|工作地点|招聘类型|校招面试|职位信息|投递方式|申请职位)/);
  return cut > 0 ? String(text).slice(0, cut).trim() : String(text).trim();
}

export function extractJobTitleFromPageText(text) {
  const raw = String(text || "");
  const labelMatch = raw.match(/(?:职位名称|岗位名称|职位标题)[:：]?\s*【[^】]*】\s*([^\n]{2,40})/);
  if (labelMatch) {
    const title = cutAtLabels(labelMatch[1]);
    if (title) return cleanTitle(title);
  }
  const bracketMatch = raw.match(/【\d{4}[^】]*】\s*([^\n]{2,40})/);
  if (bracketMatch) {
    const title = cutAtLabels(bracketMatch[1]);
    if (title) return cleanTitle(title);
  }
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const jdIndex = lines.findIndex((line) => /岗位职责|职位描述|工作职责/.test(line));
  if (jdIndex > 0) {
    for (let i = jdIndex - 1; i >= Math.max(0, jdIndex - 8); i--) {
      const line = lines[i];
      if (
        line.length >= 3 &&
        line.length <= 40 &&
        !/首页|登录|分享|收藏|投递|申请|职位|招聘|关于|联系|公司名称|企业名称|单位名称|姓名|手机|邮箱|学历|专业|毕业|推荐码|简历|发布|日期|时间|是否|外推|教育背景|实习经历|项目经历|技术技能|荣誉奖项|^\d/.test(line)
      ) {
        return cleanTitle(cutAtLabels(line));
      }
    }
  }
  return "";
}

export async function enrichJobJdWithBrowser(job, applyConfigPath = path.join(projectRoot, "config/apply.json")) {
  const config = JSON.parse(fs.readFileSync(applyConfigPath, "utf8"));
  const require = createRequire(path.resolve(config.playwrightPackage));
  const { chromium } = require("playwright");
  const url = job.posting_url || job.apply_url;
  if (!url) throw new Error("岗位缺少投递链接");
  const browser = await chromium.launch({ executablePath: config.browserExecutable, headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    await navigateToApply(page, job).catch(() => {});
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText);
    const jdText = extractJdFromPageText(text);
    return { jdText, sourceUrl: page.url() };
  } finally {
    await browser.close();
  }
}

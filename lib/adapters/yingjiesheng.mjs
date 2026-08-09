import fs from "node:fs";
import path from "node:path";
import { enrichFromRegistry } from "./smartcampus.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function grab(text, label) {
  const match = text.match(new RegExp(`^${label}[:：]?\\s*([^\\n]+)`, "m"));
  return match ? match[1].trim() : "";
}

export function parseYingjieshengJobPage(html, postingUrl) {
  const text = cleanText(html);
  const companyMatch = text.match(/^\[[^\]]*\]\s*([^\n]+)$/m);
  const company = (companyMatch || [])[1]?.trim() || "";
  const titleMatch = text.match(/职位[:：]\s*\n?\s*([^\n]{2,})/) || text.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const location = grab(text, "工作地点");
  const publishedText = grab(text, "发布时间");
  const employmentType = grab(text, "职位类型");
  const education = grab(text, "学历要求");
  const major = grab(text, "需求专业");
  const descriptionStart = text.indexOf("职位描述");
  let description = "";
  if (descriptionStart >= 0) {
    let desc = text.slice(descriptionStart);
    const cut = desc.search(/\n(?:单位详情|上一条|登录|打开APP|友情链接|©|Copyright)/);
    if (cut >= 0) desc = desc.slice(0, cut);
    description = desc.trim();
  } else {
    description = text;
  }
  const applyUrlMatch = text.match(/(?:网页端投递|网申地址|网申链接|投递链接)[：:]\s*(\S+)/) || text.match(/(https?:\/\/[^\s\n]+)/);
  const cities = (location || "").split(/\s+/).filter((c) => c && c !== "其它");
  const city = cities.includes("西安") || /西安/.test(description)
    ? "西安"
    : cities[0] || "";
  const idMatch = postingUrl.match(/job-\d+-\d+-(\d+)\.html/);
  return {
    source: "yingjiesheng",
    source_job_id: idMatch ? idMatch[1] : "",
    company,
    title,
    city,
    location,
    employment_type: employmentType || "校招正式",
    education,
    published_at: publishedText ? new Date(publishedText.replace(/-/g, "-")).toISOString() : null,
    apply_url: (applyUrlMatch && applyUrlMatch[1]) || "",
    description: [description, major ? `需求专业：${major}` : ""].filter(Boolean).join("\n"),
    posting_url: postingUrl,
    source_confidence: "medium"
  };
}

export async function fetchYingjieshengJobs(source) {
  const root = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/companies.json"), "utf8"));
  const urls = registry.seeds?.yingjieshengJobUrls || [];
  if (!urls.length) return [];
  const jobs = [];
  const failures = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9", referer: "https://m.yingjiesheng.com/" },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const job = parseYingjieshengJobPage(html, url);
      if (!job.title) continue;
      enrichFromRegistry(job, registry);
      jobs.push(job);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  if (!jobs.length && failures.length) throw new Error(failures.join("；"));
  return jobs;
}

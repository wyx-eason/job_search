import fs from "node:fs";
import path from "node:path";
import { enrichFromRegistry } from "./smartcampus.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function decodeZggqzp(buffer) {
  return new TextDecoder("gbk").decode(buffer);
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function parseZggqzpAnnounce(html, postingUrl) {
  const text = cleanText(html);
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() || "";
  const dateText = (text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/) || [])[0] || "";
  const deadlineMatch = text.match(/投递时间[：:]\s*即日起\s*-\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const deadline = deadlineMatch ? `${deadlineMatch[1]}-${pad(deadlineMatch[2])}-${pad(deadlineMatch[3])}` : null;
  const company = (text.match(/原标题[：:]*【招聘信息】([^0-9]+?)(?:\d+\s*届|$)/) || [])[1]?.trim() || "";
  return {
    source: "zggqzp",
    source_job_id: (postingUrl.match(/(\d+)\.html$/) || [])[1] || "",
    company,
    title,
    city: "上海/杭州",
    location: "上海/杭州",
    description: text,
    deadline,
    published_at: dateText ? new Date(dateText.replace(" ", "T")).toISOString() : null,
    posting_url: postingUrl,
    source_confidence: "high"
  };
}

export async function fetchZggqzpAnnounces(source) {
  const root = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/companies.json"), "utf8"));
  const urls = registry.seeds?.zggqzpAnnounceUrls || [];
  if (!urls.length) return [];
  const jobs = [];
  const failures = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9" },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const html = decodeZggqzp(buffer);
      const job = parseZggqzpAnnounce(html, url);
      if (job.title) {
        enrichFromRegistry(job, registry);
        jobs.push(job);
      }
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  if (!jobs.length && failures.length) throw new Error(failures.join("；"));
  return jobs;
}

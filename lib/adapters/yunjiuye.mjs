import fs from "node:fs";
import path from "node:path";
import { enrichFromRegistry } from "./smartcampus.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function tagClean(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function grab(pattern, html) {
  const match = html.match(pattern);
  return match ? match[1].trim() : "";
}

export function parseYunJiuyeJobPage(html, postingUrl) {
  const metas = [...html.matchAll(/<meta name="Keywords" content="([^"]*)"/gi)];
  const meta = metas.length ? metas[metas.length - 1][1] : "";
  const metaParts = meta.split(/\s+/).filter(Boolean);
  const company = metaParts.pop() || "";
  const title = metaParts.join(" ").trim() || tagClean(grab(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html));
  const salary = grab(/icon-svg-money"><\/span>\s*([^<]+)</, html);
  const location = grab(/icon-svg-location"><\/span>\s*([^<]+)</, html);
  const education = grab(/icon-svg-cap"><\/span>\s*([^<]+)</, html);
  const welfare = grab(/<p class="job-welfare">职位诱惑：([^<]*)</, html);
  const publishedText = grab(/发布时间：([^<]*)</, html);
  const description = tagClean(grab(/<div class="dm-cont">([\s\S]*?)<\/div>\s*<\/div>/i, html));
  const cities = location.split(/\s+/).filter(Boolean);
  const publishedAt = publishedText
    ? new Date(publishedText.replace(/年|月/g, "-").replace("日", "")).toISOString()
    : null;
  return {
    source: "yunjiuye",
    source_job_id: (postingUrl.match(/[?&]id=(\d+)/) || [])[1] || "",
    company,
    title,
    city: cities[0] || "",
    location,
    education,
    salary,
    welfare,
    description,
    published_at: publishedAt,
    posting_url: postingUrl,
    source_confidence: "medium"
  };
}

export async function fetchYunJiuyeJobs(source) {
  const root = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/companies.json"), "utf8"));
  const urls = registry.seeds?.yunjiuyeJobUrls || [];
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
      const html = await res.text();
      const job = parseYunJiuyeJobPage(html, url);
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

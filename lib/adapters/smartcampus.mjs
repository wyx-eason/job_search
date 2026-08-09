import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const COMPANY_RE = /([\u4e00-\u9fa5A-Za-z0-9（）()]+(?:股份有限公司|有限责任公司|有限公司|研究院|研究所|集团|科技))/;

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSmartCampusAnnounce(html, postingUrl) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() || "";
  const text = cleanText(html);
  let contentStart = text.lastIndexOf("招聘公告 详情");
  let headerLen = "招聘公告 详情".length;
  const teachinStart = text.lastIndexOf("宣讲会 详情");
  if (teachinStart > contentStart) {
    contentStart = teachinStart;
    headerLen = "宣讲会 详情".length;
  }
  const afterTitle = contentStart >= 0 ? text.slice(contentStart + headerLen) : text;
  const companyMatches = [...afterTitle.matchAll(new RegExp(COMPANY_RE.source, "g"))];
  const lastCompany =
    companyMatches.find((m) =>
      /(已过期|活动已举办|浏览次数|发布时间|宣讲时间|过期时间)/.test(afterTitle.slice(m.index + m[0].length, m.index + m[0].length + 20))
    ) || companyMatches[0] || null;
  const company = lastCompany?.[1]?.trim() || "";
  const parsedTitle = lastCompany ? afterTitle.slice(0, lastCompany.index).trim() : "";
  const expired = /已过期/.test(text);
  const expiredAt = (text.match(/过期时间：(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const publishedText = (text.match(/发布时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/) || [])[1] || null;
  const description = (() => {
    if (contentStart < 0) return text;
    let desc = afterTitle;
    const cut = desc.search(/(联系我们|学生服务：|切换移动端|友情链接|版权所有)/);
    if (cut >= 0) desc = desc.slice(0, cut);
    return desc.trim();
  })();
  return {
    source: "smartcampus",
    source_job_id: (postingUrl.match(/id\/(\d+)/) || [])[1] || "",
    company,
    title: parsedTitle || title,
    city: "",
    location: "",
    description,
    published_at: publishedText ? new Date(publishedText.replace(" ", "T")).toISOString() : null,
    expired,
    expiredAt,
    posting_url: postingUrl,
    source_confidence: "high"
  };
}

export function enrichFromRegistry(job, registry) {
  if (!job || job.city) return job;
  const companies = (registry.groups || []).flatMap((group) => group.companies || []);
  const match = companies.find(
    (c) => c.name === job.company || job.company.startsWith(c.name) || c.name.startsWith(job.company)
  );
  if (match?.city) {
    job.city = match.city;
    job.location = match.city;
  }
  return job;
}

export async function fetchSmartCampusAnnounces(source) {
  const root = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/companies.json"), "utf8"));
  const urls = registry.seeds?.smartcampusAnnounceUrls || [];
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
      const job = parseSmartCampusAnnounce(html, url);
      if (!job.title) continue;
      if (job.expired) continue; // 已过期公告不入库
      enrichFromRegistry(job, registry);
      jobs.push(job);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  if (!jobs.length && failures.length) throw new Error(failures.join("；"));
  return jobs;
}

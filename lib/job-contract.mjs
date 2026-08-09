import crypto from "node:crypto";

const CAMPUS_WORDS = /(2027\s*届|2027\s*校园|2027\s*秋招|2027\s*提前批|毕业时间[^\n]{0,40}2027|(?:^|[^0-9])27\s*届|(?:^|[^0-9])27\s*秋招|(?:^|[^0-9])27\s*提前批)/i;
const UNKNOWN_CAMPUS_WORDS = /(应届生|毕业两年内|应届毕业)/i;
const EXCLUDED_WORDS = /(实习|intern|社会招聘|社招|经验要求[^\n]{0,20}(年|年以上))/i;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeText(value) {
  return clean(value).toLowerCase().replace(/[()（）【】\[\]、，,.:：/\\_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeJob(raw = {}) {
  const description = clean(raw.jd_text ?? raw.description ?? raw.jd ?? "");
  return {
    id: clean(raw.id || raw.source_job_id || ""),
    source: clean(raw.source || "unknown"),
    source_job_id: clean(raw.source_job_id || raw.id || ""),
    company_raw: clean(raw.company || raw.company_name),
    company_normalized: normalizeText(raw.company || raw.company_name),
    title_raw: clean(raw.title || raw.job_title),
    title_normalized: normalizeText(raw.title || raw.job_title),
    posting_url: clean(raw.posting_url || raw.url),
    apply_url: clean(raw.apply_url || raw.posting_url || raw.url),
    location_raw: clean(raw.location || raw.city),
    city: clean(raw.city || raw.location),
    district: clean(raw.district),
    campus_year: raw.campus_year ? Number(raw.campus_year) : null,
    recruitment_batch: clean(raw.recruitment_batch),
    employment_type: clean(raw.employment_type || "校招正式"),
    published_at: parseDate(raw.published_at || raw.date),
    deadline: parseDate(raw.deadline),
    jd_text: description,
    source_confidence: raw.source_confidence || (raw.source === "official" ? "high" : "medium"),
    raw
  };
}

export function classifyEligibility(job, now = new Date()) {
  const head = `${job.title_raw} ${job.recruitment_batch} ${job.employment_type}`;
  const text = `${head} ${job.jd_text}`;
  if (job.deadline && new Date(job.deadline) < now) return { status: "excluded", reason: "申请截止日期已过" };
  if (/(实习|intern|社会招聘|社招)/i.test(head)) return { status: "excluded", reason: "实习或社会招聘岗位" };
  const explicitCampus = job.campus_year === 2027 || CAMPUS_WORDS.test(text);
  if (explicitCampus && !/(实习|intern)/i.test(head)) return { status: "eligible", reason: "识别到 2027 届正式校招或提前批" };
  if (EXCLUDED_WORDS.test(text)) return { status: "excluded", reason: "实习或社会招聘岗位" };
  if (UNKNOWN_CAMPUS_WORDS.test(text)) return { status: "needs_cohort_confirmation", reason: "提及应届生但未明确 2027 届范围" };
  return { status: "excluded", reason: "未识别到 2027 届校招证据" };
}

export function jobFingerprint(job) {
  if (job.source_job_id) return `source-id:${normalizeText(job.source_job_id)}`;
  const body = `${job.company_normalized}|${job.title_normalized}|${normalizeText(job.city)}|${normalizeText(job.recruitment_batch)}|${normalizeText(job.jd_text).slice(0, 1000)}`;
  return `content:${crypto.createHash("sha256").update(body).digest("hex").slice(0, 24)}`;
}

export function mergeJobs(jobs = []) {
  const grouped = new Map();
  for (const input of jobs) {
    const job = normalizeJob(input);
    const key = jobFingerprint(job);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...job, fingerprint: key, source_urls: [job.posting_url].filter(Boolean) });
      continue;
    }
    if (job.source_confidence === "high" && existing.source_confidence !== "high") Object.assign(existing, job);
    for (const url of [job.posting_url, job.apply_url]) if (url && !existing.source_urls.includes(url)) existing.source_urls.push(url);
  }
  return [...grouped.values()];
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { JUNK_TITLE_RE } from "../job-contract.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeEntities(value) {
  return value
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseQqdocsSheet(inflatedJson) {
  const parsed = JSON.parse(inflatedJson);
  const fieldsMeta = parsed?.[0]?.[0]?.c?.k3?.k3 || {};
  const rowsMap = parsed?.[0]?.[1]?.c?.k2?.k1 || {};
  const optionsOf = (fieldId) => {
    const map = {};
    for (const option of fieldsMeta[fieldId]?.k9?.k3 || []) map[option.k1] = option.k2;
    return map;
  };
  const fieldName = (fieldId) => fieldsMeta[fieldId]?.k30 || fieldId;
  const cellText = (fieldId, cell) => {
    if (!cell) return "";
    const type = cell.k30;
    if (type === 1 || type === 5) return (cell.k1 || []).map((part) => part.k2 ?? "").join("").trim();
    if (type === 4) return cell.k4 ? new Date(Number(cell.k4)).toISOString().slice(0, 10) : "";
    if (type === 8) return (cell.k8 || []).map((part) => part.k3 ?? part.k2 ?? "").join(" ").trim();
    if (type === 9) return (cell.k9 || []).map((id) => optionsOf(fieldId)[id] || id).join(", ");
    return "";
  };
  return Object.values(rowsMap).map((row) => {
    const record = {};
    for (const [fieldId, cell] of Object.entries(row.k1 || {})) record[fieldName(fieldId)] = cellText(fieldId, cell);
    return record;
  });
}

function parseDeadline(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function qqdocsRowsToJobs(rows, source = {}) {
  const { tabId = "sheet", tabName = "" } = source;
  const jobs = [];
  for (const row of rows) {
    const company = String(row["公司名称"] || "").trim();
    const title = String(row["招聘岗位"] || "").trim();
    if (!company && !title) continue;
    if (JUNK_TITLE_RE.test(title) || JUNK_TITLE_RE.test(company)) continue;
    const city = String(row["工作地点"] || "").trim();
    const url = String(row["投递链接"] || "").trim();
    const stableKey = `${company}|${title}|${city}|${url}`;
    const sourceJobId = crypto.createHash("sha1").update(stableKey).digest("hex").slice(0, 16);
    const parts = [
      `方向：${row["多选"] || ""}`,
      `内推码：${row["内推码"] || ""}`,
      `备注：${row["备注"] || ""}`,
      `笔面试信息：${row["笔面试信息"] || ""}`,
      `HR常见问题回复：${row["HR常见问题回复"] || ""}`,
      `来源：腾讯文档《${tabName}》（${tabId}）`
    ].filter((part) => part.includes("：") && part.split("：")[1]);
    jobs.push({
      source: "qqdocs",
      source_job_id: sourceJobId,
      company,
      title,
      city,
      location: city,
      posting_url: url,
      employment_type: String(row["招聘类型"] || "校招正式").trim(),
      deadline: parseDeadline(row["截止日期"]),
      description: parts.join("\n"),
      source_confidence: "medium"
    });
  }
  return jobs;
}

export async function fetchQqdocsSheet(source) {
  const root = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/companies.json"), "utf8"));
  const sheets = registry.seeds?.qqdocsSheets || [];
  const jobs = [];
  const failures = [];
  for (const sheet of sheets) {
    const { docUrl, tabId, tabName } = sheet;
    try {
      if (!docUrl) throw new Error("缺少 docUrl");
      const pageUrl = docUrl + (tabId ? `?tab=${tabId}` : "");
      const pageRes = await fetch(pageUrl, {
        headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9", referer: "https://docs.qq.com/" },
        signal: AbortSignal.timeout(30000)
      });
      if (!pageRes.ok) throw new Error(`页面 HTTP ${pageRes.status}`);
      const pageHtml = await pageRes.text();
      const apiMatch = pageHtml.match(/src=["']([^"']*dop-api\/opendoc[^"']*)["']/i);
      if (!apiMatch) throw new Error("未找到数据接口");
      const scriptUrl = apiMatch[1]
        .replace(/^\/\//, "https://")
        .replace(/&amp;/g, "&")
        .replace(/startrow=\d+/, "startrow=0")
        .replace(/endrow=\d+/, "endrow=500");
      const dataRes = await fetch(scriptUrl, {
        headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9", referer: pageUrl },
        signal: AbortSignal.timeout(30000)
      });
      if (!dataRes.ok) throw new Error(`数据接口 HTTP ${dataRes.status}`);
      const dataText = await dataRes.text();
      const cbStart = dataText.indexOf("clientVarsCallback(");
      if (cbStart < 0) throw new Error("数据接口响应格式异常");
      let jsonStr = dataText.slice(cbStart + "clientVarsCallback(".length);
      if (jsonStr.startsWith('"')) {
        const end = jsonStr.lastIndexOf('")');
        if (end < 0) throw new Error("数据接口响应格式异常");
        jsonStr = decodeEntities(jsonStr.slice(1, end));
      } else {
        const end = jsonStr.lastIndexOf(")");
        if (end < 0) throw new Error("数据接口响应格式异常");
        jsonStr = jsonStr.slice(0, end);
      }
      const json = JSON.parse(jsonStr);
      const sm = json?.clientVars?.collab_client_vars?.initialAttributedText?.text?.[0]?.smartsheet;
      if (!sm) throw new Error("未找到表格内容");
      const inflated = zlib.inflateSync(Buffer.from(sm, "base64")).toString("utf8");
      const rows = parseQqdocsSheet(inflated);
      jobs.push(...qqdocsRowsToJobs(rows, { tabId, tabName }));
    } catch (error) {
      failures.push(`${tabName || tabId || docUrl}: ${error.message}`);
    }
  }
  if (!jobs.length && failures.length) throw new Error(failures.join("；"));
  return jobs;
}

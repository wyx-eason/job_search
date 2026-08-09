import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export function loadLlmConfig({ file = path.join(root, "config/llm.json") } = {}) {
  let fromFile = null;
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      fromFile = null;
    }
  }
  const env = {
    apiKey: process.env.LLM_API_KEY || fromFile?.apiKey || "",
    baseUrl: process.env.LLM_BASE_URL || fromFile?.baseUrl || "",
    model: process.env.LLM_MODEL || fromFile?.model || "",
    apiStyle: process.env.LLM_API_STYLE || fromFile?.apiStyle || "chat",
    enabled: fromFile?.enabled !== false
  };
  if (!env.apiKey || !env.enabled) return null;
  env.baseUrl = env.baseUrl || "https://api.deepseek.com/v1";
  env.model = env.model || "deepseek-chat";
  return env;
}

function endpointUrl({ baseUrl, apiStyle = "chat" }) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (apiStyle === "responses") {
    return /\/responses$/.test(base) ? base : `${base}/responses`;
  }
  return /chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function stripCodeFence(text) {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function buildPolishPrompt({ jdText, sections, jobTitle = "", userFeedback = "" }) {
  const brief = (key, label) => {
    const items = (sections[key] || []).filter(Boolean);
    return items.length ? `${label}：\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}` : "";
  };
  const parts = [
    "你是资深求职简历润色专家。下面给出一份岗位 JD 和候选人的真实经历要点（来自其简历）。",
    "请把「实习经历」「项目经历」「技术技能」的要点改写得更贴合 JD、更精炼有力，但必须遵守：",
    "1. 只能改写、重组、合并给定的要点；严禁新增或虚构公司、职位头衔、时间段、数字、奖项、论文、技术栈等事实；",
    "2. 保留每个要点中的具体事实词（公司名、技术名、算法名、量化指标等）；",
    "3. 每条要点 1-2 句，简洁、结果导向、突出与 JD 的匹配；",
    "4. 不要使用 Markdown 标题，不要输出解释，直接输出 JSON。",
    "",
    `岗位名称：${String(jobTitle || "")}`,
    `岗位 JD：\n${String(jdText || "").slice(0, 2000)}`,
    userFeedback
      ? `用户反馈（必须逐条落实，同时仍禁止虚构公司、头衔、时间、数字、奖项、论文等事实）：\n${String(userFeedback).slice(0, 800)}`
      : "",
    "",
    brief("internship", "实习经历"),
    brief("project", "项目经历"),
    brief("skills", "技术技能"),
    "",
    '输出 JSON 格式（只输出 JSON）：\n{"internship":["改写后的实习要点..."],"project":["改写后的项目要点..."],"skills":["改写后的技能要点..."]}'
  ];
  return parts.filter(Boolean).join("\n");
}

export async function polishResumeSections({ jdText, sections, config, jobTitle = "", userFeedback = "", fetchImpl = fetch, timeoutMs = 30000 }) {
  const meta = { enabled: Boolean(config), ok: false, provider: null, model: null, error: null };
  if (!config) return { sections, meta };
  const url = endpointUrl(config);
  meta.provider = new URL(url).hostname;
  meta.model = config.model;
  const prompt = buildPolishPrompt({ jdText, sections, jobTitle, userFeedback });
  try {
    const isResponses = config.apiStyle === "responses";
    const body = isResponses
      ? {
          model: config.model,
          input: prompt,
          temperature: 0.4,
          max_output_tokens: 1800
        }
      : {
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 1800,
          response_format: { type: "json_object" }
        };
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    const content = isResponses
      ? String(
          data?.output_text ||
            (data?.output || [])
              .filter((item) => item?.type === "message")
              .flatMap((item) => item?.content || [])
              .filter((part) => part?.type === "output_text")
              .map((part) => part?.text)
              .join("\n") ||
            ""
        )
      : String(data?.choices?.[0]?.message?.content || "");
    const stripped = stripCodeFence(content);
    const parsed = JSON.parse(stripped);
    const next = {};
    for (const key of ["internship", "project", "skills"]) {
      const list = parsed[key];
      next[key] = Array.isArray(list)
        ? list.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
        : (sections[key] || []);
    }
    next.education = sections.education || [];
    next.honors = sections.honors || [];
    next.other = sections.other || [];
    meta.ok = true;
    return { sections: next, meta };
  } catch (error) {
    meta.error = error.message;
    return { sections, meta };
  }
}

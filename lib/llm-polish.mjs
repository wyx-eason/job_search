import fs from "node:fs";
import path from "node:path";
import { splitEntry, sanitizeEntryHead } from "./resume-classic.mjs";

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
    if (!items.length) return "";
    const lines = items.map((item, i) => {
      const parts = splitEntry(item);
      const title = [parts.head, parts.roleLine, parts.techLine].filter(Boolean).map((s) => s.replace(/[。]$/, "")).join(" | ");
      const bullets = parts.bullets.length
        ? `；要点：${parts.bullets.map((b, j) => `${String.fromCharCode(97 + j)}) ${b.replace(/[。]$/, "")}`).join("；")}`
        : "";
      return `${i + 1}. ${title}${bullets}`;
    });
    return `${label}：\n${lines.join("\n")}`;
  };
  const parts = [
    "你是资深求职简历润色专家。下面给出一份岗位 JD 和候选人的真实经历要点（来自其简历）。",
    "请把「实习经历」「项目经历」「技术技能」的要点改写得更贴合 JD、更精炼有力，但必须遵守：",
    "1. 只能改写、重组、合并给定的要点；严禁新增或虚构公司、职位头衔、时间段、数字、奖项、论文、技术栈等事实；",
    "2. 保留每个要点中的具体事实词（公司名、技术名、算法名、量化指标等）；",
    "3. 每条要点 1-2 句，简洁、结果导向、突出与 JD 的匹配；",
    "4. 标题行默认保持输入完全不变；仅当用户反馈明确要求修改时间/日期时，才修改标题行中的时间部分，其余（公司/地点/角色/技术栈）保持不变；",
    "5. 如果给定要点存在重复或近似表述，合并为一条，避免内容重复；与 JD 明显无关的要点可以删除（每条目至少保留一条核心要点）；",
    "6. 不要使用 Markdown 标题，不要输出解释，直接输出 JSON。",
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
    '输出 JSON 格式（只输出 JSON）：\n{"internship":[{"title":"条目标题（含时间）","bullets":["改写后的要点1","要点2"]}],"project":[{"title":"...","bullets":["..."]}],"skills":["改写后的技能要点..."]}\n注意：internship 与 project 是对象数组，顺序与输入条目一一对应，title 与输入标题一致（除非用户要求改时间）；也兼容纯数组格式 ["要点1","要点2"]（表示标题不变）；skills 是字符串数组。'
  ];
  return parts.filter(Boolean).join("\n");
}

export async function polishResumeSections({ jdText, sections, config, jobTitle = "", userFeedback = "", fetchImpl = fetch, timeoutMs = 120000 }) {
  const meta = { enabled: Boolean(config), ok: false, provider: null, model: null, error: null };
  if (!config) return { sections, meta };
  const url = endpointUrl(config);
  meta.provider = new URL(url).hostname;
  meta.model = config.model;
  const prompt = buildPolishPrompt({ jdText, sections, jobTitle, userFeedback });
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const isResponses = config.apiStyle === "responses";
      const body = isResponses
        ? {
            model: config.model,
            input: prompt,
            temperature: 0.4,
            max_output_tokens: 4000,
            reasoning: { effort: config.reasoningEffort || "medium" }
          }
        : {
            model: config.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
            max_tokens: 4000,
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
      for (const key of ["internship", "project"]) {
        const original = sections[key] || [];
        const lists = Array.isArray(parsed[key]) ? parsed[key] : [];
        next[key] = original.map((item, i) => {
          const parts = splitEntry(item);
          const entry = lists[i];
          let bullets = [];
          let newTitle = "";
          if (Array.isArray(entry)) {
            bullets = entry.map((s) => String(s).trim().replace(/[。]$/, "")).filter(Boolean).slice(0, 8);
          } else if (entry && typeof entry === "object") {
            bullets = Array.isArray(entry.bullets)
              ? entry.bullets.map((s) => String(s).trim().replace(/[。]$/, "")).filter(Boolean).slice(0, 8)
              : [];
            newTitle = String(entry.title || "").trim();
          }
          if (!bullets.length) return item;
          if (parts.date) {
            // 结构化条目：保留公司/角色/技术栈，替换要点；用户要求时允许改时间
            const head = sanitizeEntryHead(newTitle, parts.head);
            return (
              [head, parts.roleLine, parts.techLine, ...bullets]
                .filter(Boolean)
                .map((s) => String(s).replace(/[。]$/, ""))
                .join("。") + "。"
            );
          }
          // 非结构化条目：整体用改写后的要点替换
          return bullets.join("。") + "。";
        });
      }
      next.skills = Array.isArray(parsed.skills)
        ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
        : (sections.skills || []);
      next.education = sections.education || [];
      next.honors = sections.honors || [];
      next.other = sections.other || [];
      meta.ok = true;
      meta.attempts = attempt + 1;
      return { sections: next, meta };
    } catch (error) {
      lastError = error;
    }
  }
  meta.error = lastError?.message;
  meta.attempts = 2;
  return { sections, meta };
}

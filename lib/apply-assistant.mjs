import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { navigateToApply, isJobDetailUrl, cleanJobTitleForFileName, isJobDetailPageText } from "./ats-navigator.mjs";

const root = path.resolve(import.meta.dirname, "..");

const SAFE_FIELDS = [
  { key: "name", patterns: [/姓名/, /真实姓名/, /name/i] },
  { key: "phone", patterns: [/手机/, /电话/, /phone/i, /mobile/i, /tel/i] },
  { key: "email", patterns: [/邮箱/, /email/i, /邮件/] },
  { key: "university", patterns: [/学校/, /院校/, /university/i, /school/i, /college/i] },
  { key: "degree", patterns: [/学历/, /degree/i] },
  { key: "major", patterns: [/专业/, /major/i] },
  { key: "graduation", patterns: [/毕业时间/, /毕业年月/, /毕业年份/, /graduation/i] }
];

const SENSITIVE_RE = /(身份证|详细地址|政治面貌|民族|薪资|地点调剂|工作授权|背景调查|真实性声明|电子签名|密码|验证码)/i;

function readYamlValue(file, key) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(new RegExp(`^\\s*${key}:\\s*"([^"]*)"`, "m"));
  return match ? match[1].trim() : "";
}

function factsText() {
  const yml = fs.readFileSync(path.join(root, "candidate/facts.yml"), "utf8");
  return [...yml.matchAll(/claim:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("\n");
}

export function loadCandidateAutofill() {
  const autofill = path.join(root, "candidate/autofill.yml");
  const facts = factsText();
  const fromFacts = (pattern, fallback = "") => {
    const match = facts.match(pattern);
    const value = match ? (match[1] ?? match[0]) : "";
    return value ? value.trim() : fallback;
  };
  const gradMatches = [...facts.matchAll(/(20\d{2})\.(\d{2})/g)];
  const graduation = gradMatches.length ? `${gradMatches[gradMatches.length - 1][1]}-${gradMatches[gradMatches.length - 1][2]}` : "";
  const afterDegree = facts.split(/硕士研究生|博士研究生/)[1] || "";
  const cleanMajor = (value) =>
    String(value || "")
      .replace(/[（(].*?[）)]/g, "")
      .replace(/[（(][^）)]*$/g, "")
      .trim();
  return {
    name: readYamlValue(autofill, "name") || fromFacts(/([\u4e00-\u9fa5]{2,4})\s+\S+@/),
    email: readYamlValue(autofill, "email") || fromFacts(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/),
    phone: readYamlValue(autofill, "phone") || fromFacts(/(?:\+86[\s-]?)?(1[3-9]\d{9})/),
    university: readYamlValue(autofill, "university") || fromFacts(/([\u4e00-\u9fa5]{2,20}大学)/),
    degree: readYamlValue(autofill, "degree") || fromFacts(/(硕士|博士|本科)(?:研究生)?/),
    major: cleanMajor(readYamlValue(autofill, "major") || (afterDegree.match(/([\u4e00-\u9fa5A-Za-z0-9（）()\/]+(?:\s+[\u4e00-\u9fa5A-Za-z0-9（）()\/]+)*?)(?=\s*专业|$)/) || [])[1] || ""),
    graduation: readYamlValue(autofill, "graduation_date") || graduation
  };
}

export function loadFormValues(file = path.join(root, "candidate/form-values.yml")) {
  const map = {};
  if (!fs.existsSync(file)) return map;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([^#:：][^:：]*?)\s*[:：]\s*(.+?)\s*$/);
    if (match) map[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return map;
}

export function buildSelfEvaluation() {
  const facts = factsText();
  const parts = [];
  if (/(AI Agent|RAG|LLM)/.test(facts) && /(ADAS|标定|智驾)/.test(facts)) {
    parts.push("AI 应用（Agent/RAG/LLM）与 ADAS 智驾匹配标定双方向经验");
  }
  if (/(SCI|论文)/.test(facts)) {
    parts.push("硕士独立完成强化学习仿真系统，SCI 论文一作");
  }
  if (/(飞艇|强化学习|PPO)/.test(facts)) {
    parts.push("工程落地能力强，自驱、善协作");
  }
  return parts.length ? `${parts.join("；")}。` : "";
}

export function buildAwardsSummary() {
  const facts = factsText();
  const honors = [];
  const main = facts.match(/荣誉与奖项\s*([\s\S]*?)(?=\s*document|$)/);
  if (main) {
    const cleaned = main[1]
      .replace(/\s*\|\s*/g, "：")
      .replace(/\d{4}-{0,1}\d{0,4}/g, " ")
      .replace(/(核心竞赛|荣誉奖学金|基础学科)[：:]?/g, "；$1：")
      .replace(/^；/, "")
      .replace(/[：:]\s+/g, "：")
      .replace(/；\s+/g, "；")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) honors.push(cleaned);
  }
  if (/二等奖学金/.test(facts)) honors.push("研究生期间获得校级二等奖学金");
  return honors.join("；");
}

export function loadCompleteFormValues() {
  const map = loadFormValues();
  const selfEvaluation = buildSelfEvaluation();
  if (selfEvaluation) {
    map["自我评价"] = selfEvaluation;
    map["自我描述"] = selfEvaluation;
    map["个人简介"] = selfEvaluation;
  }
  const awards = buildAwardsSummary();
  if (awards) {
    map["获奖情况"] = awards;
    map["所获荣誉"] = awards;
  }
  return map;
}

async function fieldInfo(page, element) {
  return element.evaluate((node) => {
    const labelFor = (target) => {
      const id = target.id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) return label.textContent.trim();
      }
      const wrapped = target.closest("label");
      if (wrapped) return wrapped.textContent.trim();
      return "";
    };
    const firstText = (root) => {
      if (!root) return "";
      const text = (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
      return text.length <= 80 ? text : "";
    };
    const labelled = node.getAttribute("aria-labelledby");
    if (labelled) {
      const target = document.getElementById(labelled);
      const text = firstText(target);
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    const ariaLabel = node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("data-label") || node.getAttribute("data-name") || node.getAttribute("data-field");
    if (ariaLabel) {
      const text = ariaLabel.replace(/\s+/g, " ").trim();
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    const labelText = labelFor(node);
    if (labelText) return { label: labelText, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    const wrap = node.closest(".form-item, .ant-form-item, .el-form-item, .form-group, .form-field, .field, [class*='form-item'], [class*='field'], [class*='question']");
    if (wrap) {
      const explicit = [...wrap.querySelectorAll("label, .label, [class*='label'], [class*='title'], [data-label], span, [class*='question-main-content'], [class*='question-title']")]
        .map((el) => firstText(el))
        .find(Boolean);
      if (explicit) return { label: explicit, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
      const text = firstText(wrap);
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    let ancestor = node.parentElement;
    for (let i = 0; i < 8 && ancestor; i++) {
      if (ancestor.querySelectorAll("input, select, textarea").length <= 1) {
        const text = firstText(ancestor);
        if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
      }
      ancestor = ancestor.parentElement;
    }
    return {
      label: "",
      placeholder: node.getAttribute("placeholder") || "",
      name: node.getAttribute("name") || "",
      id: node.id || "",
      tag: node.tagName,
      type: node.getAttribute("type") || "text"
    };
  });
}

async function deepFormNodes(frame) {
  const list = await frame.evaluateHandle(() => {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("input, select, textarea")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  });
  const count = await list.evaluate((arr) => arr.length).catch(() => 0);
  const handles = [];
  for (let i = 0; i < count; i++) {
    const handle = (await list.evaluateHandle((arr, idx) => arr[idx], i)).asElement();
    if (handle) handles.push(handle);
  }
  return handles;
}

function describeField(handle) {
  return handle.evaluate((node) => {
    const labelFor = (target) => {
      const id = target.id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) return label.textContent.trim();
      }
      const wrapped = target.closest("label");
      if (wrapped) return wrapped.textContent.trim();
      return "";
    };
    const firstText = (root) => {
      if (!root) return "";
      const text = (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
      return text.length <= 80 ? text : "";
    };
    const labelled = node.getAttribute("aria-labelledby");
    if (labelled) {
      const target = document.getElementById(labelled);
      const text = firstText(target);
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    const ariaLabel = node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("data-label") || node.getAttribute("data-name") || node.getAttribute("data-field");
    if (ariaLabel) {
      const text = ariaLabel.replace(/\s+/g, " ").trim();
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    const labelText = labelFor(node);
    if (labelText) return { label: labelText, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    const wrap = node.closest(".form-item, .ant-form-item, .el-form-item, .form-group, .form-field, .field, [class*='form-item'], [class*='field'], [class*='question']");
    if (wrap) {
      const explicit = [...wrap.querySelectorAll("label, .label, [class*='label'], [class*='title'], [data-label], span, [class*='question-main-content'], [class*='question-title']")]
        .map((el) => firstText(el))
        .find(Boolean);
      if (explicit) return { label: explicit, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
      const text = firstText(wrap);
      if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
    }
    let ancestor = node.parentElement;
    for (let i = 0; i < 8 && ancestor; i++) {
      if (ancestor.querySelectorAll("input, select, textarea").length <= 1) {
        const text = firstText(ancestor);
        if (text) return { label: text, placeholder: node.getAttribute("placeholder") || "", name: node.getAttribute("name") || "", id: node.id || "", tag: node.tagName, type: node.getAttribute("type") || "text" };
      }
      ancestor = ancestor.parentElement;
    }
    return {
      label: "",
      placeholder: node.getAttribute("placeholder") || "",
      name: node.getAttribute("name") || "",
      id: node.id || "",
      tag: node.tagName,
      type: node.getAttribute("type") || "text"
    };
  });
}

async function captureFormFields(page) {
  const fields = [];
  for (const frame of page.frames()) {
    for (const handle of await deepFormNodes(frame)) {
      const info = await describeField(handle).catch(() => null);
      if (info) fields.push(info);
    }
  }
  return fields;
}

async function collectFormFields(page) {
  const handles = [];
  for (const frame of page.frames()) handles.push(...(await deepFormNodes(frame)));
  return handles;
}

function installApplyInteractionTracking() {
      if (window.__applyAssistantTouchReady) return;
      window.__applyAssistantTouchReady = true;
      window.__userTouched = new WeakSet();
      window.__applyJobSelected = false;
      window.__applySelectedJobTitle = "";
      const mark = (e) => {
        // 只记录真实用户输入（isTrusted），程序自动填充不会标记
        if (e.isTrusted && e.target && e.target.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
          window.__userTouched.add(e.target);
        }
      };
      const markActivity = (e) => {
        if (e.isTrusted) window.__applyLastActiveAt = Date.now();
      };
      const markJobSelected = (e) => {
        if (!e.isTrusted) return;
        const path = e.composedPath ? e.composedPath() : [e.target];
        const clickedText = path
          .map((el) => (el && el.textContent ? String(el.textContent).replace(/\s+/g, " ").trim() : ""))
          .find(Boolean) || "";
        if (/^(立即投递|投递简历|去投递|申请职位|申请该职位|申请)$/.test(clickedText)) {
          const roots = [document];
          for (let i = 0; i < roots.length; i++) {
            for (const el of roots[i].querySelectorAll("*")) {
              if (el.shadowRoot) roots.push(el.shadowRoot);
            }
          }
          let jobTitle = "";
          for (const root of roots) {
            const headings = root.querySelectorAll("h1, h2");
            for (const heading of headings) {
              const text = String(heading.textContent || "").replace(/\s+/g, " ").trim();
              if (text.length >= 4 && text.length <= 80) {
                jobTitle = text;
                break;
              }
            }
            if (jobTitle) break;
          }
          const pageText = roots
            .map((root) => String(root.body?.innerText || root.host?.shadowRoot?.textContent || ""))
            .filter(Boolean)
            .join("\n");
          const snapshot = {
            url: location.href,
            jobTitle: jobTitle || window.__applySelectedJobTitle || "",
            pageText,
            clickedAt: performance.timeOrigin + performance.now(),
            commitSequence: (window.__applyCommitSequence = (window.__applyCommitSequence || 0) + 1)
          };
          window.__applyCommittedJob = snapshot;
          window.__applyAssistantCommitJob?.(snapshot);
          return;
        }
        // 用 composedPath 穿透 shadow DOM，记录真实点击的岗位卡片标题
        const text = path
          .map((el) => (el && el.textContent ? String(el.textContent).replace(/\s+/g, " ").trim() : ""))
          .find((s) => s.length >= 4 && s.length <= 80 && /工程师|设计师|算法|开发|产品经理|运营|测试|研发|专员|经理|校招|秋招/.test(s));
        if (text) {
          window.__applyJobSelected = true;
          window.__applySelectedJobTitle = text;
        }
      };
      document.addEventListener("input", mark, true);
      document.addEventListener("change", mark, true);
      document.addEventListener("click", markJobSelected, true);
      document.addEventListener("pointerdown", markActivity, true);
      document.addEventListener("keydown", markActivity, true);
      document.addEventListener("wheel", markActivity, true);
      // 新打开/聚焦的页面视为用户当前所在页，供“按当前页面生成简历”定位
      window.__applyLastActiveAt = Date.now();
      document.addEventListener("focus", markActivity, true);
      document.addEventListener("visibilitychange", markActivity, true);
}

async function ensureUserTouchTracking(page) {
  await page
    .evaluate(installApplyInteractionTracking)
    .catch(() => {});
}

function killProcessesUsingProfile(profileDir) {
  return new Promise((resolve) => {
    const needle = String(profileDir).replace(/\\/g, "\\\\").replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    execFile("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true }, () => resolve());
  });
}

export async function getPageInnerText(page) {
  const texts = await Promise.all(
    page.frames().map((frame) =>
      frame
        .evaluate(() => {
          const collect = (root, acc) => {
            if (!root) return;
            for (const node of root.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                acc.push(node.textContent);
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.shadowRoot) collect(node.shadowRoot, acc);
                collect(node, acc);
              }
            }
          };
          const acc = [];
          collect(document.body || document.documentElement, acc);
          return acc.join("\n");
        })
        .catch(() => "")
    )
  );
  return texts.join("\n");
}

export async function findActivePage(context, fallbackPage = null) {
  const pages = context?.pages?.() || [];
  let best = null;
  let bestScore = -1;
  for (const candidate of pages) {
    if (candidate.isClosed()) continue;
    const info = await candidate
      .evaluate(() => ({
        at: Number(window.__applyLastActiveAt || 0),
        visible: document.visibilityState === "visible",
        focused: document.hasFocus()
      }))
      .catch(() => ({ at: 0, visible: false, focused: false }));
    // 只有存在用户活动/加载时间标记的页面才参与竞争；聚焦与可见仅作为加权，
    // 避免无标记的空白页（如初始 about:blank）被误判为当前页
    const score = info.at > 0 ? info.at + (info.visible ? 1000 : 0) + (info.focused ? 2000 : 0) : -1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best) return best;
  if (fallbackPage && !fallbackPage.isClosed()) return fallbackPage;
  return pages.find((p) => !p.isClosed()) || null;
}

export function normalizeJobTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    .replace(/27届|秋招|校招|校园招聘/g, "");
}

export function extractJobsFromApiPayload(payload) {
  const data = payload?.data ?? payload?.Data;
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.list)
      ? data.list
      : data && typeof data === "object" && (data.positionName || data.JobAdName || data.JobName || data.Title)
        ? [data]
        : [];
  const jobs = [];
  for (const item of items) {
    const title = String(item.positionName || item.positionTitle || item.jobName || item.name || item.JobAdName || item.JobName || item.Title || "").trim();
    if (!title) continue;
    const duty = String(item.positionDescription || item.jobDescription || item.description || item.duty || item.Duty || item.JobDescription || item.Description || "").trim();
    const require = String(item.positionRequirement || item.jobRequirement || item.requirement || item.require || item.Require || item.Requirement || "").trim();
    jobs.push({ title, jd: [duty, require].filter(Boolean).join("\n"), id: String(item.id ?? item.positionId ?? item.jobId ?? item.Id ?? item.JobAdId ?? "") });
  }
  return jobs;
}

function attachJobApiCapture(page, jobMap) {
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/\/api\/Jobad\//i.test(url) && !/\/api\/.*(job|position)/i.test(url)) return;
      const text = await res.text().catch(() => "");
      const data = JSON.parse(text);
      for (const job of extractJobsFromApiPayload(data)) {
        jobMap.set(normalizeJobTitle(job.title), job);
      }
    } catch {
      // 非 JSON 或解析失败忽略
    }
  });
}

export async function autofillApplyForm(page, candidate, options = {}) {
  await ensureUserTouchTracking(page);
  const fields = await collectFormFields(page);
  const count = fields.length;
  const result = { filled: [], skippedSensitive: [], skippedUnknown: [], userEdited: 0, submitted: false };
  const overrides = options.formValues || {};
  for (let i = 0; i < count; i++) {
    const element = fields[i];
    const visible = await element
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
      })
      .catch(() => false);
    if (!visible) continue;
    const userTouched = await element
      .evaluate((el) => {
        const set = window.__userTouched;
        return !!(set && set.has(el));
      })
      .catch(() => false);
    if (userTouched) {
      result.userEdited = (result.userEdited || 0) + 1;
      continue;
    }
    const info = await fieldInfo(page, element);
    const labelText = `${info.label} ${info.placeholder} ${info.name} ${info.id}`.trim();
    const overrideKey = Object.keys(overrides).find((key) => labelText.includes(key));
    if (overrideKey) {
      const value = String(overrides[overrideKey] || "").trim();
      if (!value) continue;
      const current = await element.evaluate((el) => el.value || "").catch(() => "");
      if (current && current.trim()) {
        result.alreadyFilled = (result.alreadyFilled || 0) + 1;
        continue;
      }
      try {
        if (info.tag === "SELECT") {
          const option = await element.evaluate(
            (node, expected) => {
              const found = [...node.options].find((o) => o.textContent.includes(expected) || o.value === expected);
              return found ? found.value : "";
            },
            value
          );
          if (!option) {
            result.skippedUnknown.push(`${labelText || overrideKey}（无匹配选项）`);
            continue;
          }
          await element.selectOption(option);
        } else {
          await element.fill(value);
        }
        result.filled.push(`自定义·${labelText || overrideKey}=${value}`);
      } catch (error) {
        result.skippedUnknown.push(`${labelText || overrideKey}: ${error.message.split("\n")[0]}`);
      }
      continue;
    }
    if (SENSITIVE_RE.test(labelText)) {
      result.skippedSensitive.push(labelText || info.name || "未知字段");
      continue;
    }
    const field = SAFE_FIELDS.find((f) => f.patterns.some((p) => p.test(labelText)));
    if (!field) {
      result.skippedUnknown.push(labelText || info.name || "未知字段");
      continue;
    }
    const value = candidate[field.key];
    if (!value) {
      result.skippedUnknown.push(`${field.key}（无数据）`);
      continue;
    }
    const current = await element.evaluate((el) => el.value || "").catch(() => "");
    if (current && current.trim()) {
      result.alreadyFilled = (result.alreadyFilled || 0) + 1;
      continue; // 已有内容（含用户编辑），不覆盖、不滚动
    }
    try {
      if (info.tag === "SELECT") {
        const option = await element.evaluate(
          (node, expected) => {
            const found = [...node.options].find((o) => o.textContent.includes(expected) || o.value === expected);
            return found ? found.value : "";
          },
          value
        );
        if (!option) {
          result.skippedUnknown.push(`${labelText || field.key}（无匹配选项）`);
          continue;
        }
        await element.selectOption(option);
      } else {
        const fillValue = info.type === "date" && value.length === 7 ? `${value}-01` : value;
        await element.fill(fillValue);
      }
      result.filled.push(`${labelText || field.key}=${value}`);
    } catch (error) {
      result.skippedUnknown.push(`${labelText || field.key}: ${error.message.split("\n")[0]}`);
    }
  }
  const resumePdfPath = options.getResumePdfPath ? options.getResumePdfPath() : options.resumePdfPath;
  if (resumePdfPath) {
    result.uploadedResume = await uploadResumeToForm(page, resumePdfPath, { isCurrent: options.isUploadCurrent });
    if (!result.uploadedResume) result.resumeUploadSkipped = "未找到简历上传入口，请手动上传";
  }
  result.formFields = await captureFormFields(page);
  return result;
}

export async function uploadResumeToForm(page, resumePdfPath, options = {}) {
  for (const handle of await collectFormFields(page)) {
    const type = await handle.getAttribute("type").catch(() => "");
    if (type !== "file") continue;
    try {
      await handle.setInputFiles(resumePdfPath);
      if (options.isCurrent && !options.isCurrent()) {
        await handle.setInputFiles([]).catch(() => {});
        return false;
      }
      return true;
    } catch {
      // 尝试下一个文件输入
    }
  }
  return false;
}

export function looksLikeApplyForm(fields) {
  const labels = (fields || []).map((f) => `${f.label || ""} ${f.placeholder || ""} ${f.name || ""}`.toLowerCase()).join(" ");
  const hitPatterns = [
    "姓名",
    "手机",
    "电话",
    "邮箱",
    "邮件",
    "推荐码",
    "resumekey",
    "简历",
    /\bname\b/,
    /\bphone\b/,
    /\bmobile\b/,
    /\btel\b/,
    /\bemail\b/,
    /\bmail\b/,
    /\buniversity\b/,
    /\bschool\b/,
    /\bcollege\b/,
    /\bdegree\b/,
    /\bmajor\b/,
    /\bgraduation\b/,
    /\bresume\b/
  ];
  const hits = hitPatterns.filter((pattern) => (pattern instanceof RegExp ? pattern.test(labels) : labels.includes(pattern)));
  return hits.length >= 2;
}

export function prepareUploadResume(packagePath, company, title) {
  const companyPart = cleanJobTitleForFileName(company) || "公司";
  const titlePart = cleanJobTitleForFileName(title);
  const base = titlePart ? `王奕迅_${titlePart}` : `王奕迅_${companyPart}`;
  const src = path.join(packagePath, "resume.pdf");
  const dest = path.join(packagePath, `${base}.pdf`);
  if (!fs.existsSync(dest) || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs) {
    fs.copyFileSync(src, dest);
  }
  return dest;
}

export async function showBanner(page, text) {
  await page
    .evaluate((msg) => {
      document.getElementById("apply-assistant-banner")?.remove();
      const el = document.createElement("div");
      el.id = "apply-assistant-banner";
      el.textContent = msg;
      Object.assign(el.style, {
        position: "fixed",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999999,
        background: "#16a34a",
        color: "#fff",
        padding: "10px 18px",
        borderRadius: "8px",
        fontSize: "14px",
        boxShadow: "0 2px 8px rgba(0,0,0,.3)",
        fontFamily: "sans-serif",
        maxWidth: "90vw"
      });
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 15000);
    }, text)
    .catch(() => {});
}

export async function waitAndAutofill(page, candidate, maxWaitMs = 60000, options = {}) {
  const start = Date.now();
  const size = (r) => (r.filled?.length || 0) + (r.skippedSensitive?.length || 0) + (r.skippedUnknown?.length || 0);
  let lastError = "";
  const safeAutofill = async () => {
    try {
      const result = await autofillApplyForm(page, candidate, options);
      lastError = "";
      return result;
    } catch (error) {
      // 页面跳转/重渲染时 Playwright 可能报 "Frame was detached"，
      // 不中断整个投递会话，下一轮轮询继续尝试
      lastError = error.message;
      return { filled: [], skippedSensitive: [], skippedUnknown: [], error: error.message, formFields: [] };
    }
  };
  let result = await safeAutofill();
  let best = result;
  let idleRounds = 0;
  let lastFilled = result.filled.length;
  while (Date.now() - start < maxWaitMs) {
    if (idleRounds >= 2) break;
    try {
      await page.waitForTimeout(3000);
    } catch (error) {
      // 浏览器窗口被用户关闭或页面崩溃时，停止轮询并返回已收集结果
      lastError = error.message;
      break;
    }
    const next = await safeAutofill();
    if (size(next) > size(best)) best = next;
    if (next.filled.length > lastFilled || (size(next) > 0 && lastFilled === 0)) idleRounds = 0;
    else idleRounds++;
    result = next;
    lastFilled = result.filled.length;
  }
  result = best;
  result.formFields = await captureFormFields(page).catch(() => []);
  const touched = size(result);
  if (lastError && touched === 0) {
    result.note = `页面加载或跳转中，自动填写暂未执行（${lastError}）；助手会持续监听，进入申请表单后会自动填写。`;
  } else if ((result.filled?.length || 0) === 0 && touched > 0) {
    result.note = `检测到 ${result.skippedUnknown?.length || 0} 个字段但未能自动识别（如：${(result.skippedUnknown || []).slice(0, 3).join("、")}）。可点击"重新填表"，或手动填写。`;
  } else if (touched === 0) {
    result.note = "未检测到可填写的申请表单：该链接可能是公司岗位列表页或公告页，请先选择具体岗位（首次需登录）。检测到表单后会自动填写。";
  }
  return result;
}

export function startFormWatcher({ page, candidate, resumePdfPath, formValues = {}, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, pollIntervalMs = 3000, maxPolls = null, jobMap = null, autoFill = true }) {
  let currentResumePdfPath = resumePdfPath;
  const committedJobs = [];
  const handledCommits = new Set();
  const knownFormPages = new Set();
  let excludedFormPages = new Set();
  let selectionSourcePage = null;
  let selectionRevision = 0;
  let receiveSequence = 0;
  let polling = false;
  let drainingCommits = false;
  let lastHandledClickedAt = -Infinity;
  let lastHandledReceiveSequence = -Infinity;
  const context = page.context();
  const commitKey = (commit) => `${commit.clickedAt}:${commit.commitSequence || 0}:${commit.url}:${commit.jobTitle || ""}`;
  const drainCommittedJobs = async () => {
    if (drainingCommits) return;
    drainingCommits = true;
    try {
      while (committedJobs.length) {
        const latest = committedJobs
          .splice(0)
          .sort((a, b) =>
            (a.clickedAt || 0) - (b.clickedAt || 0) ||
            (a.receiveSequence || 0) - (b.receiveSequence || 0)
          )
          .at(-1);
        if (latest) await handleCommit(latest);
      }
    } finally {
      drainingCommits = false;
    }
  };
  const handleCommit = async (commit) => {
    const key = commitKey(commit);
    if (handledCommits.has(key)) return;
    const validDetail = isJobDetailUrl(commit.url)
      || isJobDetailPageText(commit.pageText)
      || (Boolean(commit.jobTitle) && /(岗位职责|职位描述|工作职责|任职要求|岗位要求|工作内容|职位信息|岗位介绍|岗位描述)/.test(commit.pageText));
    if (!validDetail) return;
    const clickedAt = Number(commit.clickedAt || 0);
    const receive = Number(commit.receiveSequence || 0);
    if (clickedAt < lastHandledClickedAt || (clickedAt === lastHandledClickedAt && receive < lastHandledReceiveSequence)) return;
    lastHandledClickedAt = clickedAt;
    lastHandledReceiveSequence = receive;
    handledCommits.add(key);
    selectionRevision++;
    currentResumePdfPath = null;
    selectionSourcePage = commit.page;
    excludedFormPages = new Set([
      ...knownFormPages,
      ...context.pages().filter((candidatePage) => candidatePage !== commit.page)
    ]);
    onJobSelection?.({ revision: selectionRevision, page: commit.page, url: commit.url });
    const matched = jobMap ? jobMap.get(normalizeJobTitle(commit.jobTitle)) : null;
    console.log(`[投递会话] 用户从岗位详情点击投递 | 岗位=${commit.jobTitle}${matched ? " | 已匹配接口JD" : ""}`);
    onJobDetail?.({
      revision: selectionRevision,
      url: commit.url,
      page: commit.page,
      pageText: commit.pageText,
      jobTitle: commit.jobTitle || undefined,
      jdText: matched?.jd || undefined
    });
  };
  const bindingReady = context.exposeBinding("__applyAssistantCommitJob", async ({ page: sourcePage }, snapshot) => {
    const commit = { page: sourcePage, receiveSequence: ++receiveSequence, ...snapshot };
    committedJobs.push(commit);
    await drainCommittedJobs();
  }).catch(() => {}).then(() => context.addInitScript(installApplyInteractionTracking)).catch(() => {});
  bindingReady.then(() => ensureUserTouchTracking(page));
  let polls = 0;
  let lastFieldsJson = "";
  const timer = setInterval(async () => {
    if (polling) return;
    polling = true;
    polls++;
    if (maxPolls && polls >= maxPolls) {
      clearInterval(timer);
      polling = false;
      return;
    }
    if (page.isClosed()) {
      clearInterval(timer);
      polling = false;
      return;
    }
    try {
      await bindingReady;
      // 扫描上下文里所有标签页（用户可能跳到新标签页选岗位）
      const seen = new Set([page]);
      const pages = [page];
      for (const candidate of page.context().pages()) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          pages.push(candidate);
        }
      }
      for (const candidatePage of pages) {
        if (candidatePage.isClosed()) continue;
        await ensureUserTouchTracking(candidatePage);
        const localCommit = await candidatePage.evaluate(() => {
          const snapshot = window.__applyCommittedJob || null;
          window.__applyCommittedJob = null;
          return snapshot;
        }).catch(() => null);
        if (localCommit) committedJobs.push({ page: candidatePage, receiveSequence: ++receiveSequence, ...localCommit });
      }
      if (committedJobs.length) await drainCommittedJobs();
      // 在所有标签页里找真正的申请表单（用户点“投递”后可能新开标签页/跳转到表单页）
      let formPage = null;
      for (const candidatePage of [...pages].reverse()) {
        if (candidatePage.isClosed()) continue;
        await ensureUserTouchTracking(candidatePage);
        const fields = await captureFormFields(candidatePage);
        if (looksLikeApplyForm(fields || [])) {
          knownFormPages.add(candidatePage);
          if (excludedFormPages.has(candidatePage) && candidatePage !== selectionSourcePage) continue;
          formPage = candidatePage;
          break;
        }
      }
      if (!formPage) return;
      const fillRevision = selectionRevision;
      const result = autoFill
        ? await autofillApplyForm(formPage, candidate, {
            resumePdfPath: currentResumePdfPath,
            formValues,
            isUploadCurrent: () => fillRevision === selectionRevision
          })
        : { filled: [], skippedSensitive: [], skippedUnknown: [], formFields: await captureFormFields(formPage) };
      if (fillRevision !== selectionRevision) return;
      if (looksLikeApplyForm(result.formFields || [])) onApplyForm?.({ revision: fillRevision, fields: result.formFields || [], page: formPage });
      const fieldsJson = JSON.stringify(result.formFields || []);
      if (fieldsJson !== lastFieldsJson) {
        lastFieldsJson = fieldsJson;
        onFieldsChange?.(result.formFields || [], result);
      }
    } catch {
      // 轮询失败忽略，继续等待
    } finally {
      polling = false;
    }
  }, pollIntervalMs);
  return {
    ready: bindingReady,
    stop: () => clearInterval(timer),
    setResumePdfPath: (nextPath) => {
      currentResumePdfPath = nextPath || null;
    }
  };
}

const DEFAULT_APPLY_BROWSERS = [
  {
    executablePath: path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    profileDir: "local/edge-profile"
  },
  {
    executablePath: path.join(process.env.ProgramFiles || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"),
    profileDir: "local/edge-profile"
  },
  {
    executablePath: path.join(process.env.LOCALAPPDATA || "C:/Users/A/AppData/Local", "Microsoft/Edge/Application/msedge.exe"),
    profileDir: "local/edge-profile"
  },
  {
    executablePath: path.join(process.env.LOCALAPPDATA || "C:/Users/A/AppData/Local", "Google/Chrome/Application/chrome.exe"),
    profileDir: "local/chrome-profile"
  }
];

function resolveFromRoot(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

// 投递浏览器默认用 Edge；配置里的 Edge 不存在时回退到配置的无头浏览器（Chrome），再回退到本机已知安装路径。
export function resolveApplyBrowser(config = {}) {
  const candidates = [
    { executablePath: config.applyBrowserExecutable, profileDir: config.applyProfileDir },
    { executablePath: config.browserExecutable, profileDir: config.profileDir },
    ...DEFAULT_APPLY_BROWSERS
  ];
  for (const candidate of candidates) {
    const executablePath = resolveFromRoot(candidate.executablePath);
    if (!executablePath || !fs.existsSync(executablePath)) continue;
    return {
      executablePath,
      profileDir: resolveFromRoot(candidate.profileDir) || path.join(root, "local/edge-profile")
    };
  }
  throw new Error("config/apply.json 里配置的浏览器都不存在，请检查 applyBrowserExecutable / browserExecutable 路径");
}

export async function runApplyAssistant({ applyUrl, config, job = {}, headless = false, maxWaitMs = 30000, resumePdfPath = null, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, autoNavigate = true, autoFill = true }) {
  const require = createRequire(path.resolve(config.playwrightPackage));
  const { chromium } = require("playwright");
  const { executablePath, profileDir } = resolveApplyBrowser(config);
  fs.mkdirSync(profileDir, { recursive: true });
  const launchOptions = {
    executablePath,
    headless,
    viewport: null,
    args: ["--start-maximized", "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check"]
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    // 共享 profile 可能被残留浏览器进程锁住：先清理占用该 profile 的进程，
    // 再重试共享 profile，保住登录态；仍失败才退临时 profile 兜底
    console.error(`[投递助手] 共享 profile 启动失败（${error.message}），清理占用进程后重试`);
    await killProcessesUsingProfile(profileDir);
    await new Promise((r) => setTimeout(r, 800));
    try {
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (error2) {
      console.error(`[投递助手] 共享 profile 重试仍失败（${error2.message}），使用临时 profile（登录态不会保留）`);
      const tempProfile = fs.mkdtempSync(path.join(root, "local", "profile-tmp-"));
      context = await chromium.launchPersistentContext(tempProfile, launchOptions);
    }
  }
  const page = await context.newPage();
  const jobMap = new Map();
  attachJobApiCapture(page, jobMap);
  context.on("page", (newPage) => {
    attachJobApiCapture(newPage, jobMap);
    ensureUserTouchTracking(newPage);
  });
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const navigation = autoNavigate
    ? await navigateToApply(page, job)
    : { matched: false, log: ["手动模式：已打开投递链接，请在浏览器中自行搜索并打开目标岗位 JD 页"] };
  const candidate = loadCandidateAutofill();
  const formValues = loadCompleteFormValues();
  const watcher = startFormWatcher({ page, candidate, resumePdfPath, formValues, onFieldsChange, onJobSelection, onJobDetail, onApplyForm, jobMap, autoFill });
  await watcher.ready;
  const result = autoFill
    ? await waitAndAutofill(page, candidate, maxWaitMs, { resumePdfPath, formValues })
    : {
        formFields: [],
        filled: [],
        skippedSensitive: [],
        skippedUnknown: [],
        userEdited: 0,
        submitted: false,
        note: "手动模式：请在浏览器中打开目标岗位 JD 页，然后点“按当前页面生成简历”；在页面点投递后，再点“填表（当前页面）”。"
      };
  result.submitted = false;
  result.navigation = navigation;
  return { page, context, result, watcher };
}

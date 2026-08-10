import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { navigateToApply, isJobDetailUrl, cleanJobTitleForFileName, looksLikeJobDetailText } from "./ats-navigator.mjs";

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
    return {
      label: labelFor(node),
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
    return {
      label: labelFor(node),
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

async function ensureUserTouchTracking(page) {
  await page
    .evaluate(() => {
      if (window.__applyAssistantTouchReady) return;
      window.__applyAssistantTouchReady = true;
      window.__userTouched = new WeakSet();
      const mark = (e) => {
        // 只记录真实用户输入（isTrusted），程序自动填充不会标记
        if (e.isTrusted && e.target && e.target.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
          window.__userTouched.add(e.target);
        }
      };
      document.addEventListener("input", mark, true);
      document.addEventListener("change", mark, true);
    })
    .catch(() => {});
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
  if (options.resumePdfPath) {
    result.uploadedResume = await uploadResumeToForm(page, options.resumePdfPath);
    if (!result.uploadedResume) result.resumeUploadSkipped = "未找到简历上传入口，请手动上传";
  }
  result.formFields = await captureFormFields(page);
  return result;
}

export async function uploadResumeToForm(page, resumePdfPath) {
  for (const handle of await collectFormFields(page)) {
    const type = await handle.getAttribute("type").catch(() => "");
    if (type !== "file") continue;
    try {
      await handle.setInputFiles(resumePdfPath);
      return true;
    } catch {
      // 尝试下一个文件输入
    }
  }
  return false;
}

export function looksLikeApplyForm(fields) {
  const labels = (fields || []).map((f) => `${f.label || ""} ${f.placeholder || ""} ${f.name || ""}`.toLowerCase()).join(" ");
  const hits = ["姓名", "手机", "邮箱", "推荐码", "resumekey", "简历"].filter((k) => labels.includes(k));
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

export function startFormWatcher({ page, candidate, resumePdfPath, onFieldsChange, onJobDetail, onApplyForm, pollIntervalMs = 3000, maxPolls = null }) {
  let polls = 0;
  let lastFieldsJson = "";
  let lastDetailUrl = "";
  const timer = setInterval(async () => {
    polls++;
    if (maxPolls && polls >= maxPolls) {
      clearInterval(timer);
      return;
    }
    if (page.isClosed()) {
      clearInterval(timer);
      return;
    }
    try {
      const url = page.url();
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
      const isDetail = isJobDetailUrl(url) || looksLikeJobDetailText(pageText);
      if (isDetail && url !== lastDetailUrl) {
        lastDetailUrl = url;
        onJobDetail?.({ url });
      }
      const result = await autofillApplyForm(page, candidate, { resumePdfPath });
      if (looksLikeApplyForm(result.formFields || [])) onApplyForm?.({ fields: result.formFields || [] });
      const fieldsJson = JSON.stringify(result.formFields || []);
      if (fieldsJson !== lastFieldsJson) {
        lastFieldsJson = fieldsJson;
        onFieldsChange?.(result.formFields || [], result);
      }
    } catch {
      // 轮询失败忽略，继续等待
    }
  }, pollIntervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runApplyAssistant({ applyUrl, config, job = {}, headless = false, maxWaitMs = 30000, resumePdfPath = null, onFieldsChange, onJobDetail, onApplyForm }) {
  const require = createRequire(path.resolve(config.playwrightPackage));
  const { chromium } = require("playwright");
  const profileDir = path.isAbsolute(config.profileDir)
    ? config.profileDir
    : path.join(root, config.profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  const launchOptions = {
    executablePath: config.browserExecutable,
    headless,
    viewport: null,
    args: ["--start-maximized", "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check"]
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    // 共享 profile 可能被残留进程锁住或被其他浏览器（如 Edge）污染，
    // 一次失败时改用临时 profile 兜底，避免投递会话打不开
    const tempProfile = fs.mkdtempSync(path.join(root, "local", "profile-tmp-"));
    context = await chromium.launchPersistentContext(tempProfile, launchOptions);
  }
  const page = await context.newPage();
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const navigation = await navigateToApply(page, job);
  const candidate = loadCandidateAutofill();
  const formValues = loadCompleteFormValues();
  const result = await waitAndAutofill(page, candidate, maxWaitMs, { resumePdfPath, formValues });
  result.submitted = false;
  result.navigation = navigation;
  const watcher = startFormWatcher({ page, candidate, resumePdfPath, onFieldsChange, onJobDetail, onApplyForm });
  return { page, context, result, watcher };
}

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  loadFacts,
  classifyFacts,
  selectBestFacts,
  selectBaseResumeFacts,
  mergeSectionsFromFacts,
  extractJobKeywords,
  buildMatchReport,
  buildFormAnswers,
  buildAudit
} from "./resume-builder.mjs";
import { buildClassicResumeHtml } from "./resume-classic.mjs";
import { runResumeQa } from "./resume-qa.mjs";
import { cleanJobTitleForFileName } from "./ats-navigator.mjs";
import { loadLlmConfig, polishResumeSections } from "./llm-polish.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function htmlToPdf(html, applyConfigPath) {
  const config = JSON.parse(fs.readFileSync(applyConfigPath, "utf8"));
  const require = createRequire(path.resolve(config.playwrightPackage));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: config.browserExecutable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" }
    });
  } finally {
    await browser.close();
  }
}

export async function generateApplicationPackage({
  job,
  root = projectRoot,
  verifiedOnly = false,
  applyConfigPath = path.join(projectRoot, "config/apply.json"),
  enrichJd,
  polish = true,
  userFeedback = ""
}) {
  const company = job.company_raw || job.company || "";
  const title = job.title_raw || job.title || "";
  if (!company || !title || !job?.jd_text) {
    throw new Error("岗位缺少公司、岗位名称或 JD 内容");
  }
  let effectiveJd = job.jd_text || "";
  let jdSource = "岗位库";
  const isThin = effectiveJd.length < 80 || !/(岗位职责|任职要求|职位描述|工作职责)/.test(effectiveJd);
  if (isThin && enrichJd) {
    try {
      const enriched = await enrichJd(job);
      if (enriched?.jdText) {
        effectiveJd = enriched.jdText;
        jdSource = enriched.sourceUrl || "招聘系统岗位页";
      }
    } catch (error) {
      jdSource = `岗位库（自动抓取失败：${error.message}）`;
    }
  }
  const normalizedJob = { ...job, company_raw: company, title_raw: title, jd_text: effectiveJd };
  const allFacts = loadFacts();
  const selection = selectBaseResumeFacts(allFacts, effectiveJd);
  const facts = selection.facts;
  const candidate = buildFormAnswers();
  const keywords = extractJobKeywords(normalizedJob);
  let sections = mergeSectionsFromFacts(facts);
  const llmConfig = polish ? loadLlmConfig() : null;
  let polishMeta = null;
  if (llmConfig) {
    const polished = await polishResumeSections({ jdText: effectiveJd, sections, config: llmConfig, jobTitle: title, userFeedback });
    sections = polished.sections;
    polishMeta = polished.meta;
  }
  const html = buildClassicResumeHtml({ candidate, sections, keywords, job: normalizedJob });
  const report = buildMatchReport({ job: normalizedJob, candidate, sections, keywords, facts });
  const answers = buildFormAnswers();
  const shortTitle = cleanJobTitleForFileName(title) || "岗位";
  const safe = `${new Date().toISOString().slice(0, 10)}_${company}_${shortTitle}`.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_");
  const packagePath = path.join(root, "output", "applications", safe);
  fs.mkdirSync(packagePath, { recursive: true });

  fs.writeFileSync(path.join(packagePath, "job-description.md"), `# ${company} - ${title}\n\n${effectiveJd}\n\n---\nJD 来源：${jdSource}\n`, "utf8");
  fs.writeFileSync(path.join(packagePath, "match-report.md"), report, "utf8");
  fs.writeFileSync(path.join(packagePath, "resume.html"), html, "utf8");
  fs.writeFileSync(path.join(packagePath, "form-answers.json"), JSON.stringify(answers, null, 2), "utf8");

  let pdf = null;
  try {
    pdf = await htmlToPdf(html, applyConfigPath);
    const tmpPdf = path.join(packagePath, "resume.pdf.tmp");
    fs.writeFileSync(tmpPdf, pdf);
    fs.renameSync(tmpPdf, path.join(packagePath, "resume.pdf"));
  } catch (error) {
    fs.rmSync(path.join(packagePath, "resume.pdf.tmp"), { force: true });
    fs.rmSync(path.join(packagePath, "resume.pdf"), { force: true });
    throw new Error(`PDF 生成失败（其余文件已保留）: ${error.message}`);
  }
  const qa = runResumeQa({ html, candidate, keywords, pdfSize: pdf ? pdf.length : 0 });
  if (!keywords.all.length) {
    qa.warnings.push("JD 过粗（未识别到关键词），简历未做针对性调整，请确认岗位描述后再投递");
  }
  if (polishMeta?.ok) {
    qa.warnings.push(`简历经 LLM 润色（${polishMeta.provider}/${polishMeta.model}），投递前请人工核对事实`);
  }
  const audit = buildAudit({ facts, job: normalizedJob, sections, keywords, verifiedOnly, jdSource, qa, mode: selection.mode, polish: polishMeta });
  fs.writeFileSync(path.join(packagePath, "generation-audit.json"), JSON.stringify(audit, null, 2), "utf8");

  return {
    packagePath,
    status: "ready_for_review",
    files: ["job-description.md", "match-report.md", "resume.html", "resume.pdf", "form-answers.json", "generation-audit.json"],
    qa,
    polish: polishMeta
  };
}

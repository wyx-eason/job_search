import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDashboardData } from "./api.mjs";
import { runApplyAssistant, autofillApplyForm, loadCandidateAutofill, uploadResumeToForm, prepareUploadResume, showBanner, loadCompleteFormValues, getPageInnerText, findActivePage } from "../lib/apply-assistant.mjs";
import { openStore } from "../lib/store.mjs";
import { transitionStatus, statusLabel } from "../lib/application-tracker.mjs";
import { extractJdFromPageText, extractJobTitleFromPageText } from "../lib/jd-enricher.mjs";
import { generateApplicationPackage } from "../lib/application-generator.mjs";
import { shouldAutoRegenerate, urlKey } from "../lib/regen-guard.mjs";
import { isJobDetailPageText } from "../lib/ats-navigator.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const html = fs.readFileSync(path.join(here, "index.html"), "utf8");

function countPdfPages(buf) {
  const text = buf.toString("latin1");
  const tree = text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/i);
  if (tree) return Number(tree[1]);
  const pages = text.match(/\/Type\s*\/Page\b/gi);
  return pages ? pages.length : null;
}

process.on("unhandledRejection", (error) => {
  console.error(`[未处理的拒绝] ${error?.stack || error}`);
});
process.on("uncaughtException", (error) => {
  console.error(`[未捕获异常] ${error?.stack || error}`);
});

export function createDashboardServer(options = {}) {
  const { dbPath, preferencesPath, sourcesPath, host = "127.0.0.1", port = 8787, applyAssistant = runApplyAssistant, locateActivePage = findActivePage, readPageText = getPageInnerText, generatePackage = generateApplicationPackage } = options;
  const applySessions = new Map();
  const applyInflight = new Set();
  async function regenerateForCurrentJob(session, { auto = false } = {}) {
    if (session.regenLock) {
      // 正在生成时又检测到新岗位：记录待办，当前生成结束后按最新页面状态重跑
      session.pendingRegen = { auto };
      console.log(`[投递会话] ${auto ? "自动" : "手动"}重生成排队（当前正在生成中）`);
      return null;
    }
    session.regenLock = true;
    try {
      const selectedRevision = session.selectedRevision || 0;
      const detailPage = session.selectedDetailPage || session.page;
      const text = session.selectedPageText || await getPageInnerText(detailPage);
      // 手动点击/提交意见 = 用户明确要求重做，跳过“JD 未变化”类防重复限制；
      // JD 取页面实时内容，页面里没有就复用上次成功生成时的 JD，保证预览丢失后仍可重生成
      const force = !auto;
      // 若用户点击岗位卡片且已匹配到接口 JD（如 vivo），优先用接口数据，避免页面显示默认岗位
      const useSelected = Boolean(session.selectedJobTitle && (session.selectedJobJd || session.selectedPageText));
      const jdText = useSelected
        ? session.selectedJobJd || extractJdFromPageText(session.selectedPageText)
        : extractJdFromPageText(text) || session.lastJdText || session.job.jd_text || "";
      // 自动与普通手动重生成都要求页面是真实岗位详情（带 JD 标记），
      // 避免把内推页/登录页/列表页的文字当 JD；提交意见的反馈模式允许复用上次 JD
      const requireMarkers = !session.feedback;
      const detailUrl = session.selectedDetailUrl || detailPage.url();
      const guard = shouldAutoRegenerate({ lastRegen: session.lastRegen, jdText, url: detailUrl, requireMarkers, force, detailOk: isJobDetailPageText(text) });
      if (!guard.ok) {
        if (auto) session.lastAutoAttempt = { at: new Date().toISOString(), ok: false, reason: guard.reason };
        console.log(`[投递会话] 重生成跳过（${auto ? "自动" : "手动"}）：${guard.reason} | url=${detailUrl}`);
        return { skipped: guard.reason };
      }
      const pageTitle = useSelected ? session.selectedJobTitle : extractJobTitleFromPageText(text);
      console.log(`[投递会话] 开始${auto ? "自动" : "手动"}重生成 | 岗位=${pageTitle || session.job.title_raw} | jdLen=${jdText.length} | url=${detailUrl}`);
      const regenJob = {
        ...session.job,
        jd_text: jdText,
        title_raw: String(pageTitle || "").trim().slice(0, 60) || session.job.title_raw
      };
      const pkg = await generateApplicationPackage({ job: regenJob, root, userFeedback: session.feedback || "" });
      console.log(`[投递会话] 重生成完成 | ${pkg.packagePath} | QA=${pkg.qa?.ok}`);
      if ((session.selectedRevision || 0) !== selectedRevision) {
        console.log(`[投递会话] 丢弃过期生成结果 | 岗位=${regenJob.title_raw} | 当前选择版本=${session.selectedRevision}`);
        return { stale: true };
      }
      const uploadPdf = prepareUploadResume(pkg.packagePath, regenJob.company, regenJob.title_raw);
      const uploadPage = session.formPage;
      const uploaded = uploadPage
        ? await uploadResumeToForm(uploadPage, uploadPdf, { isCurrent: () => (session.selectedRevision || 0) === selectedRevision })
        : false;
      if ((session.selectedRevision || 0) !== selectedRevision) {
        console.log(`[投递会话] 上传期间岗位已切换，撤销过期简历 | 岗位=${regenJob.title_raw}`);
        return { stale: true };
      }
      session.resumePdfPath = uploadPdf;
      session.watcher?.setResumePdfPath(uploadPdf);
      session.lastRegen = {
        at: new Date().toISOString(),
        url: detailUrl,
        jdText,
        jdTextNorm: jdText.replace(/\s+/g, ""),
        urlKey: urlKey(detailUrl),
        packagePath: pkg.packagePath,
        qa: pkg.qa,
        polish: pkg.polish || null,
        feedback: session.feedback || "",
        uploaded,
        uploadedFileName: path.basename(uploadPdf)
      };
      session.lastJdText = jdText;
      session.lastAutoAttempt = { at: new Date().toISOString(), ok: true, reason: "ok" };
      if (uploaded && uploadPage) {
        await showBanner(uploadPage, `✓ 简历已按当前岗位重新生成并上传：${path.basename(uploadPdf)}（QA ${pkg.qa?.ok ? "通过" : "有问题"}）`);
      }
      return session.lastRegen;
    } catch (error) {
      console.error(`[投递会话] 重生成失败：${error.message}`);
      session.lastAutoAttempt = { at: new Date().toISOString(), ok: false, reason: `生成失败：${error.message}` };
      return null;
    } finally {
      session.regenLock = false;
      const pending = session.pendingRegen;
      session.pendingRegen = null;
      if (pending) {
        regenerateForCurrentJob(session, { auto: pending.auto }).catch((error) => {
          session.lastAutoAttempt = { at: new Date().toISOString(), ok: false, reason: `生成失败：${error.message}` };
        });
      }
    }
  }

  async function generateResumeFromCurrentPage(session) {
    const activePage = await locateActivePage(session.context, session.page);
    if (!activePage || activePage.isClosed()) throw new Error("没有可用的浏览器页面，请重新点击“去投递”");
    const text = await readPageText(activePage);
    if (!isJobDetailPageText(text)) {
      return { error: "当前页面不是具体岗位 JD 页，请先在浏览器里打开目标岗位的职位详情页（页面需含岗位职责/任职要求等内容）" };
    }
    const jobTitle = extractJobTitleFromPageText(text) || session.job?.title_raw || session.job?.title || "";
    const jdText = extractJdFromPageText(text) || session.lastJdText || session.job?.jd_text || "";
    if (!jdText) return { error: "未能从当前页面提取到 JD 内容" };
    const job = {
      ...(session.job || {}),
      company_raw: session.job?.company_raw || session.job?.company || "",
      title_raw: jobTitle || session.job?.title_raw || "岗位",
      jd_text: jdText
    };
    const pkg = await generatePackage({ job, root, userFeedback: session.feedback || "" });
    const uploadPdf = prepareUploadResume(pkg.packagePath, job.company_raw, job.title_raw);
    session.resumePdfPath = uploadPdf;
    session.watcher?.setResumePdfPath?.(uploadPdf);
    session.lastRegen = {
      at: new Date().toISOString(),
      url: activePage.url(),
      jdText,
      packagePath: pkg.packagePath,
      qa: pkg.qa,
      polish: pkg.polish || null,
      uploaded: false,
      uploadedFileName: path.basename(uploadPdf),
      feedback: session.feedback || ""
    };
    session.lastJdText = jdText;
    session.lastJobTitle = jobTitle;
    return {
      packagePath: pkg.packagePath,
      files: pkg.files,
      qa: pkg.qa,
      polish: pkg.polish || null,
      uploadedFileName: path.basename(uploadPdf),
      jobTitle,
      jdLen: jdText.length,
      url: activePage.url()
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && req.url === "/api/dashboard") {
        const data = loadDashboardData({ dbPath, preferencesPath, sourcesPath });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
        return;
      }
      if (req.method === "POST" && req.url === "/api/apply") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { jobId } = JSON.parse(body || "{}");
        if (!jobId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "缺少 jobId" }));
          return;
        }
        const store = openStore(dbPath);
        const job = store.listJobs({}).find((row) => row.id === jobId);
        store.close();
        if (!job) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "岗位不存在" }));
          return;
        }
        const applyUrl = job.apply_url || job.posting_url;
        if (!applyUrl) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "该岗位没有投递链接" }));
          return;
        }
        const applyConfig = JSON.parse(fs.readFileSync(path.join(root, "config/apply.json"), "utf8"));
        const deferResume = true;
        if (applyInflight.has(job.id)) {
          res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "该岗位正在打开投递页面，请稍候" }));
          return;
        }
        const existingSession = applySessions.get(job.id);
        if (existingSession && !existingSession.page?.isClosed()) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              sessionId: job.id,
              reused: true,
              note: "该岗位已有打开的投递会话，继续使用当前浏览器页面",
              deferResume,
              packagePath: existingSession.packagePath || null,
              files: existingSession.files || [],
              qa: existingSession.qa || null,
              uploadedFileName: existingSession.resumePdfPath ? path.basename(existingSession.resumePdfPath) : null,
              formFieldsPath: existingSession.formFieldsPath || null,
              applyUrl,
              ...existingSession.result
            })
          );
          return;
        }
        applyInflight.add(job.id);
        try {
          for (const [key, session] of applySessions) {
            if (key === job.id) continue;
            session.watcher?.stop();
            await session.context.close().catch(() => {});
            applySessions.delete(key);
          }
          if (existingSession) applySessions.delete(job.id);
          let pkg = null;
          let resumePdfPath = null;
          const fieldsDir = path.join(root, "output", "form-fields");
          fs.mkdirSync(fieldsDir, { recursive: true });
          const fieldsFile = path.join(fieldsDir, `${job.id}-${Date.now()}.json`);
          const writeFields = (fields) =>
            fs.writeFileSync(
              fieldsFile,
              JSON.stringify({ jobId: job.id, company: job.company, url: applyUrl, capturedAt: new Date().toISOString(), fields }, null, 2),
              "utf8"
            );
          let assistant = null;
          assistant = await applyAssistant({
            applyUrl,
            config: applyConfig,
            job,
            headless: false,
            autoNavigate: false,
            autoFill: false,
            resumePdfPath,
            onFieldsChange: (fields) => writeFields(fields),
            onJobSelection: ({ revision } = {}) => {
              const session = applySessions.get(job.id) || assistant;
              if (session) {
                session.selectedRevision = Math.max(session.selectedRevision || 0, revision || 0);
                session.formPage = null;
                session.resumePdfPath = null;
              }
            },
            onJobDetail: ({ revision, page: detailPage, url: detailUrl, pageText, jobTitle, jdText } = {}) => {
              const session = applySessions.get(job.id) || assistant;
              if (session) {
                if (detailPage && !detailPage.isClosed()) session.selectedDetailPage = detailPage;
                session.selectedDetailUrl = detailUrl || detailPage?.url() || "";
                session.selectedPageText = pageText || "";
                if (jobTitle) session.selectedJobTitle = jobTitle;
                session.selectedJobJd = jdText || extractJdFromPageText(pageText || "") || "";
                session.selectedRevision = Math.max(session.selectedRevision || 0, revision || 0);
                session.lastWatcherEvent = { at: new Date().toISOString(), type: "jobDetail" };
                console.log(`[投递会话] 锁定用户投递的岗位详情 | 岗位=${session.selectedJobTitle || "未知"} | url=${session.selectedDetailUrl}`);
                // 手动模式：不自动重生成，等待用户点击“按当前页面生成简历”
              }
            },
            onApplyForm: ({ revision, page: formPage } = {}) => {
              const session = applySessions.get(job.id) || assistant;
              if (session && (revision || 0) === (session.selectedRevision || 0)) {
                if (formPage && !formPage.isClosed()) session.formPage = formPage;
                session.lastWatcherEvent = { at: new Date().toISOString(), type: "applyForm" };
                console.log(`[投递会话] 检测到申请表单 | url=${formPage ? formPage.url() : ""}`);
              }
            }
          });
          writeFields(assistant.result.formFields || []);
          applySessions.set(job.id, {
            ...assistant,
            resumePdfPath,
            packagePath: pkg?.packagePath || null,
            files: pkg?.files || [],
            qa: pkg?.qa || null,
            formFieldsPath: fieldsFile,
            job,
            regenLock: false,
            lastRegen: null,
            selectedRevision: 0
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              sessionId: job.id,
              deferResume,
              packagePath: pkg?.packagePath || null,
              files: pkg?.files || [],
              qa: pkg?.qa || null,
              uploadedFileName: resumePdfPath ? path.basename(resumePdfPath) : null,
              formFieldsPath: fieldsFile,
              applyUrl,
              ...assistant.result
            })
          );
        } finally {
          applyInflight.delete(job.id);
        }
        return;
      }
      if (req.method === "POST" && req.url === "/api/apply/current-resume") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { sessionId, jobId } = JSON.parse(body || "{}");
        const session = applySessions.get(sessionId || jobId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有打开的投递会话，请重新点击去投递" }));
          return;
        }
        const out = await generateResumeFromCurrentPage(session);
        if (out?.error) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: out.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
        return;
      }
      if (req.method === "POST" && req.url === "/api/apply/refill") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { sessionId, jobId } = JSON.parse(body || "{}");
        const session = applySessions.get(sessionId || jobId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有打开的投递会话，请重新点击去投递" }));
          return;
        }
        const result = await autofillApplyForm(session.formPage || session.selectedDetailPage || session.page, loadCandidateAutofill(), { resumePdfPath: session.resumePdfPath, formValues: loadCompleteFormValues() });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
        return;
      }
      if (req.method === "POST" && req.url === "/api/apply/regenerate") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { sessionId, jobId } = JSON.parse(body || "{}");
        const session = applySessions.get(sessionId || jobId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有打开的投递会话，请重新点击去投递" }));
          return;
        }
        const regen = await regenerateForCurrentJob(session);
        if (!regen || regen.skipped) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: regen?.skipped || "未能从当前页面提取岗位 JD，请先打开具体岗位页面" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(regen));
        return;
      }
      if (req.method === "POST" && req.url === "/api/apply/feedback") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { sessionId, feedback } = JSON.parse(body || "{}");
        const session = applySessions.get(sessionId || "");
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有打开的投递会话，请重新点击去投递" }));
          return;
        }
        const feedbackText = String(feedback || "").trim();
        if (!feedbackText) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "请先填写修改意见" }));
          return;
        }
        session.feedback = feedbackText;
        try {
          const regen = await regenerateForCurrentJob(session);
          if (!regen || regen.skipped) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: regen?.skipped || "未能从当前页面提取岗位 JD，请先打开具体岗位页面" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ...regen, feedback: session.feedback }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: `重新生成失败：${error.message}` }));
        }
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/apply/status")) {
        const jobId = new URL(req.url, "http://localhost").searchParams.get("jobId");
        const session = applySessions.get(jobId || "");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            sessionOpen: Boolean(session),
            regenInProgress: Boolean(session?.regenLock),
            lastRegen: session?.lastRegen || null,
            lastAutoAttempt: session?.lastAutoAttempt || null,
            lastWatcherEvent: session?.lastWatcherEvent || null
          })
        );
        return;
      }
      const statusMatch = req.url.match(/^\/api\/jobs\/([^/]+)\/status$/);
      if (req.method === "POST" && statusMatch) {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { status, packagePath } = JSON.parse(body || "{}");
        const store = openStore(dbPath);
        try {
          const result = transitionStatus({ store, jobId: decodeURIComponent(statusMatch[1]), to: status, packagePath });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: error.message }));
        } finally {
          store.close();
        }
        return;
      }
      if (req.method === "POST" && req.url === "/api/open-package") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { packagePath } = JSON.parse(body || "{}");
        const resolved = path.resolve(String(packagePath || ""));
        const appsRoot = path.resolve(root, "output", "applications");
        if (!resolved.startsWith(appsRoot + path.sep)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "路径不在申请包目录内" }));
          return;
        }
        if (!fs.existsSync(resolved)) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "目录不存在" }));
          return;
        }
        spawn("explorer.exe", [resolved], { detached: true, stdio: "ignore" }).unref();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ opened: resolved }));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/package/resume")) {
        const packagePath = new URL(req.url, "http://localhost").searchParams.get("packagePath");
        const resolved = path.resolve(String(packagePath || ""));
        const appsRoot = path.resolve(root, "output", "applications");
        if (!resolved.startsWith(appsRoot + path.sep)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "路径不在申请包目录内" }));
          return;
        }
        const file = path.join(resolved, "resume.html");
        if (!fs.existsSync(file)) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "该申请包还没有简历" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(file, "utf8"));
        return;
      }
      const packageMetaMatch = req.url?.match(/^\/api\/package\/(pdf|meta)\b/);
      if (req.method === "GET" && packageMetaMatch) {
        const kind = packageMetaMatch[1];
        const packagePath = new URL(req.url, "http://localhost").searchParams.get("packagePath");
        const resolved = path.resolve(String(packagePath || ""));
        const appsRoot = path.resolve(root, "output", "applications");
        if (!resolved.startsWith(appsRoot + path.sep)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "路径不在申请包目录内" }));
          return;
        }
        const pdfFile = path.join(resolved, "resume.pdf");
        if (kind === "pdf") {
          if (!fs.existsSync(pdfFile)) {
            res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "该申请包还没有简历 PDF" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": "inline" });
          res.end(fs.readFileSync(pdfFile));
          return;
        }
        const hasPdf = fs.existsSync(pdfFile);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ hasPdf, pages: hasPdf ? countPdfPages(fs.readFileSync(pdfFile)) : null }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/companies/delete") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { company } = JSON.parse(body || "{}");
        if (!company) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "缺少公司名称" }));
          return;
        }
        const store = openStore(dbPath);
        try {
          const result = store.deleteJobsByCompany(company);
          store.blockCompany(company);
          for (const [key, session] of applySessions) {
            if (result.ids.includes(key) || session.job?.company === company) {
              session.watcher?.stop();
              await session.context.close().catch(() => {});
              applySessions.delete(key);
            }
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ deleted: result.deleted, blocked: company }));
        } finally {
          store.close();
        }
        return;
      }
      if (req.method === "POST" && req.url === "/api/companies/restore") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { company } = JSON.parse(body || "{}");
        if (!company) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "缺少公司名称" }));
          return;
        }
        const store = openStore(dbPath);
        try {
          const result = store.unblockCompany(company);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } finally {
          store.close();
        }
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("未找到");
    } catch (error) {
      console.error(`[请求失败] ${req.method} ${req.url}: ${error?.stack || error}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve(`http://${host}:${addr.port}`);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      });
    }
  };
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const app = createDashboardServer({
    dbPath: path.join(root, "data/jobs.db"),
    preferencesPath: path.join(root, "candidate/preferences.json"),
    sourcesPath: path.join(root, "config/sources.json"),
    host: "127.0.0.1",
    port: 8787
  });
  const url = await app.listen();
  console.log(`仪表盘已启动：${url}（Ctrl+C 停止）`);
}

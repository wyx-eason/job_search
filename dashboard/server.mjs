import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDashboardData } from "./api.mjs";
import { createApplicationPackage } from "../lib/career-ops-bridge.mjs";
import { runApplyAssistant, autofillApplyForm, loadCandidateAutofill, uploadResumeToForm, prepareUploadResume, showBanner, loadCompleteFormValues, getPageInnerText } from "../lib/apply-assistant.mjs";
import { openStore } from "../lib/store.mjs";
import { transitionStatus, statusLabel } from "../lib/application-tracker.mjs";
import { extractJdFromPageText, extractJobTitleFromPageText, enrichJobJdWithBrowser } from "../lib/jd-enricher.mjs";
import { generateApplicationPackage } from "../lib/application-generator.mjs";
import { shouldAutoRegenerate, urlKey } from "../lib/regen-guard.mjs";
import { shouldDeferResume } from "../lib/ats-navigator.mjs";

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
  const { dbPath, preferencesPath, sourcesPath, host = "127.0.0.1", port = 8787, applyAssistant = runApplyAssistant } = options;
  const applySessions = new Map();
  const applyInflight = new Set();
  async function regenerateForCurrentJob(session, { auto = false } = {}) {
    if (session.regenLock) return null;
    session.regenLock = true;
    try {
      if (auto) {
        if ((session.autoRegenCount || 0) >= 3) return { skipped: "已自动重新生成 3 次，如需再次请点手动按钮" };
        if (session.lastRegen && Date.now() - new Date(session.lastRegen.at).getTime() < 10000) {
          return { skipped: "10 秒内不重复自动生成" };
        }
      }
      const text = await getPageInnerText(session.page);
      // 手动点击/提交意见 = 用户明确要求重做，跳过“JD 未变化/同一岗位”类防重复限制；
      // JD 取页面实时内容，页面里没有就复用上次成功生成时的 JD，保证预览丢失后仍可重生成
      const force = !auto;
      const jdText = extractJdFromPageText(text) || session.lastJdText || session.job.jd_text || "";
      const guard = shouldAutoRegenerate({ lastRegen: session.lastRegen, jdText, url: session.page.url(), requireMarkers: !auto, force });
      if (!guard.ok) {
        if (auto) session.lastAutoAttempt = { at: new Date().toISOString(), ok: false, reason: guard.reason };
        return { skipped: guard.reason };
      }
      const pageTitle = extractJobTitleFromPageText(text);
      const regenJob = {
        ...session.job,
        jd_text: jdText,
        title_raw: String(pageTitle || "").trim().slice(0, 60) || session.job.title_raw
      };
      const pkg = await generateApplicationPackage({ job: regenJob, root, userFeedback: session.feedback || "" });
      const uploadPdf = prepareUploadResume(pkg.packagePath, regenJob.company, regenJob.title_raw);
      const uploaded = await uploadResumeToForm(session.page, uploadPdf);
      session.resumePdfPath = uploadPdf;
      session.lastRegen = {
        at: new Date().toISOString(),
        url: session.page.url(),
        jdText,
        jdTextNorm: jdText.replace(/\s+/g, ""),
        urlKey: urlKey(session.page.url()),
        packagePath: pkg.packagePath,
        qa: pkg.qa,
        polish: pkg.polish || null,
        feedback: session.feedback || "",
        uploaded,
        uploadedFileName: path.basename(uploadPdf)
      };
      session.lastJdText = jdText;
      if (auto) session.autoRegenCount = (session.autoRegenCount || 0) + 1;
      session.lastAutoAttempt = { at: new Date().toISOString(), ok: true, reason: "ok" };
      if (uploaded) {
        await showBanner(session.page, `✓ 简历已按当前岗位重新生成并上传：${path.basename(uploadPdf)}（QA ${pkg.qa?.ok ? "通过" : "有问题"}）`);
      }
      return session.lastRegen;
    } finally {
      session.regenLock = false;
    }
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
        const deferResume = shouldDeferResume(job, applyUrl);
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
          if (!deferResume) {
            pkg = await createApplicationPackage(job, {}, undefined, { enrichJd: enrichJobJdWithBrowser });
            resumePdfPath = prepareUploadResume(pkg.packagePath, job.company, job.title);
          }
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
            resumePdfPath,
            onFieldsChange: (fields) => writeFields(fields),
            onJobDetail: () => {
              const session = applySessions.get(job.id) || assistant;
              if (session) {
                session.lastWatcherEvent = { at: new Date().toISOString(), type: "jobDetail" };
                regenerateForCurrentJob(session, { auto: true }).catch(() => {});
              }
            },
            onApplyForm: () => {
              const session = applySessions.get(job.id) || assistant;
              if (session) {
                session.lastWatcherEvent = { at: new Date().toISOString(), type: "applyForm" };
                regenerateForCurrentJob(session, { auto: true }).catch(() => {});
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
            autoRegenCount: 0
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
        const result = await autofillApplyForm(session.page, loadCandidateAutofill(), { resumePdfPath: session.resumePdfPath, formValues: loadCompleteFormValues() });
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

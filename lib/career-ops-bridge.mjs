import fs from "node:fs";
import path from "node:path";

export function createApplicationPackage(job, candidate, root = path.resolve(import.meta.dirname, "..")) {
  if (!job?.company_raw || !job?.title_raw || !job?.jd_text) throw new Error("岗位缺少公司、岗位名称或 JD 内容");
  const safe = `${new Date().toISOString().slice(0, 10)}_${job.company_raw}_${job.title_raw}`.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_");
  const packagePath = path.join(root, "output", "applications", safe);
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(path.join(packagePath, "job-description.md"), `# ${job.company_raw} - ${job.title_raw}\n\n${job.jd_text}\n`, "utf8");
  fs.writeFileSync(path.join(packagePath, "match-report.md"), "# 匹配报告\n\n待调用 career-ops 生成详细评估。\n", "utf8");
  fs.writeFileSync(path.join(packagePath, "generation-audit.json"), JSON.stringify({ job_id: job.id || null, candidate_source: candidate?.source || "candidate/", status: "pending" }, null, 2), "utf8");
  return { packagePath, status: "ready_for_review" };
}

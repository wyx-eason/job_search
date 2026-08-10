export const FLOW_STATUSES = ["discovered", "shortlisted", "resume_generated", "ready_for_review", "applied", "assessment", "interview", "offer"];
export const TERMINAL_STATUSES = ["rejected", "withdrawn", "expired", "discarded"];
export const ALL_STATUSES = [...FLOW_STATUSES, ...TERMINAL_STATUSES];

const STATUS_LABELS = {
  discovered: "已发现",
  shortlisted: "已入选择",
  resume_generated: "已生成简历",
  ready_for_review: "待检查",
  applied: "已投递",
  assessment: "测评中",
  interview: "面试中",
  offer: "Offer",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  expired: "已过期",
  discarded: "已丢弃"
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function nextStatuses(status) {
  if (TERMINAL_STATUSES.includes(status)) return [];
  const index = FLOW_STATUSES.indexOf(status);
  const next = index >= 0 && index < FLOW_STATUSES.length - 1 ? [FLOW_STATUSES[index + 1]] : [];
  return [...next, ...TERMINAL_STATUSES];
}

export function validateTransition(from, to) {
  if (!ALL_STATUSES.includes(from)) return { ok: false, error: `未知起始状态: ${from}` };
  if (!ALL_STATUSES.includes(to)) return { ok: false, error: `未知目标状态: ${to}` };
  if (TERMINAL_STATUSES.includes(from)) return { ok: false, error: `终态 ${from} 不允许再流转` };
  if (TERMINAL_STATUSES.includes(to)) return { ok: true };
  const fromIndex = FLOW_STATUSES.indexOf(from);
  const toIndex = FLOW_STATUSES.indexOf(to);
  // 已投递是关键里程碑：允许从任意投前状态直达（投递完成后无需逐个点中间态）
  if (to === "applied" && toIndex > fromIndex) return { ok: true };
  if (toIndex === fromIndex + 1) return { ok: true };
  return { ok: false, error: `不允许从 ${statusLabel(from)} 直接到 ${statusLabel(to)}` };
}

export function transitionStatus({ store, jobId, to, packagePath = null }) {
  const job = store.listJobs({}).find((row) => row.id === jobId);
  if (!job) throw new Error(`岗位不存在: ${jobId}`);
  const check = validateTransition(job.status, to);
  if (!check.ok) throw new Error(check.error);
  const now = new Date().toISOString();
  store.updateJobStatus(jobId, to);
  if (to === "applied") {
    store.db
      .prepare(
        `INSERT INTO applications (job_id, package_path, status, applied_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, package_path = COALESCE(excluded.package_path, applications.package_path), applied_at = COALESCE(applications.applied_at, excluded.applied_at)`
      )
      .run(jobId, packagePath, to, now);
  }
  return { jobId, from: job.status, to, at: now };
}

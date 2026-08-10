import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeText, JUNK_TITLE_RE } from "./job-contract.mjs";

const schema = fs.readFileSync(path.resolve(import.meta.dirname, "../data/schema.sql"), "utf8");

export function openStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(schema);
  return {
    db,
    close: () => db.close(),
    upsertJobs(jobs) {
      const now = new Date().toISOString();
      const blocked = db
        .prepare("SELECT name_normalized FROM blocked_companies")
        .all()
        .map((row) => row.name_normalized);
      const isBlocked = (job) =>
        blocked.some((name) => {
          const company = job.company_normalized || "";
          return company && (company === name || company.includes(name) || name.includes(company));
        });
      const select = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
      const insert = db.prepare(`INSERT INTO jobs (id,fingerprint,source,source_job_id,company,title,posting_url,apply_url,location,city,campus_year,recruitment_batch,employment_type,published_at,deadline,jd_text,source_confidence,eligibility_status,eligibility_reason,pool,score_json,status,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const update = db.prepare(`UPDATE jobs SET source=?,source_job_id=?,company=?,title=?,posting_url=?,apply_url=?,location=?,city=?,campus_year=?,recruitment_batch=?,employment_type=?,published_at=?,deadline=?,jd_text=?,source_confidence=?,eligibility_status=?,eligibility_reason=?,pool=?,score_json=?,last_seen_at=? WHERE fingerprint=?`);
      const sourceInsert = db.prepare("INSERT OR IGNORE INTO job_sources (job_id,source,url) VALUES (?,?,?)");
      let added = 0; let updated = 0;
      let blockedSkipped = 0;
      let junkSkipped = 0;
      for (const job of jobs) {
        if (JUNK_TITLE_RE.test(job.title_raw || "")) {
          junkSkipped++;
          continue;
        }
        if (isBlocked(job)) {
          blockedSkipped++;
          continue;
        }
        const existing = select.get(job.fingerprint);
        const id = existing?.id || job.id || `${job.fingerprint.slice(0, 12)}-${added + updated}`;
        const values = [job.source, job.source_job_id || null, job.company_raw, job.title_raw, job.posting_url || null, job.apply_url || null, job.location_raw || null, job.city || null, job.campus_year || null, job.recruitment_batch || null, job.employment_type || null, job.published_at || null, job.deadline || null, job.jd_text || null, job.source_confidence || null, job.eligibility?.status || null, job.eligibility?.reason || null, job.pool || null, JSON.stringify(job.score || null)];
        if (existing) { update.run(...values, now, job.fingerprint); updated++; } else { insert.run(id, job.fingerprint, ...values, "discovered", now, now); added++; }
        for (const url of job.source_urls || [job.posting_url]) if (url) sourceInsert.run(id, job.source || "unknown", url);
      }
      return { added, updated, blockedSkipped, junkSkipped };
    },
    blockCompany(company) {
      const name = String(company || "").trim();
      if (!name) throw new Error("缺少公司名称");
      const normalized = normalizeText(name);
      db.prepare(
        "INSERT INTO blocked_companies (name, name_normalized, blocked_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET name_normalized=excluded.name_normalized, blocked_at=excluded.blocked_at"
      ).run(name, normalized, new Date().toISOString());
      return { company: name };
    },
    unblockCompany(company) {
      const name = String(company || "").trim();
      const info = db.prepare("DELETE FROM blocked_companies WHERE name = ?").run(name);
      return { company: name, removed: Number(info.changes) > 0 };
    },
    listBlockedCompanies() {
      return db.prepare("SELECT name, blocked_at FROM blocked_companies ORDER BY blocked_at DESC").all();
    },
    deleteJobsByCompany(company) {
      const normalized = normalizeText(String(company || ""));
      if (!normalized) throw new Error("缺少公司名称");
      const rows = db.prepare("SELECT id, company FROM jobs").all();
      const ids = rows
        .filter((row) => {
          const company = normalizeText(row.company);
          return company && (company === normalized || company.includes(normalized) || normalized.includes(company));
        })
        .map((row) => row.id);
      if (!ids.length) return { deleted: 0, ids: [] };
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(`DELETE FROM job_sources WHERE job_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM applications WHERE job_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...ids);
      return { deleted: ids.length, ids };
    },
    listJobs(filters = {}) {
      const clauses = []; const params = [];
      if (filters.status) { clauses.push("status = ?"); params.push(filters.status); }
      if (filters.pool) { clauses.push("pool = ?"); params.push(filters.pool); }
      const query = `SELECT * FROM jobs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY last_seen_at DESC`;
      return db.prepare(query).all(...params);
    },
    recordScan(run) {
      db.prepare("INSERT INTO scan_runs (id,started_at,finished_at,summary_json) VALUES (?,?,?,?)").run(run.id, run.started_at, run.finished_at || null, JSON.stringify(run.summary || {}));
    },
    updateJobStatus(id, status) { db.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id); }
  };
}

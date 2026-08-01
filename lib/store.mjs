import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
      const select = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
      const insert = db.prepare(`INSERT INTO jobs (id,fingerprint,source,source_job_id,company,title,posting_url,apply_url,location,city,campus_year,recruitment_batch,employment_type,published_at,deadline,jd_text,source_confidence,eligibility_status,eligibility_reason,pool,score_json,status,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const update = db.prepare(`UPDATE jobs SET source=?,source_job_id=?,company=?,title=?,posting_url=?,apply_url=?,location=?,city=?,campus_year=?,recruitment_batch=?,employment_type=?,published_at=?,deadline=?,jd_text=?,source_confidence=?,eligibility_status=?,eligibility_reason=?,pool=?,score_json=?,last_seen_at=? WHERE fingerprint=?`);
      const sourceInsert = db.prepare("INSERT OR IGNORE INTO job_sources (job_id,source,url) VALUES (?,?,?)");
      let added = 0; let updated = 0;
      for (const job of jobs) {
        const existing = select.get(job.fingerprint);
        const id = existing?.id || job.id || `${job.fingerprint.slice(0, 12)}-${added + updated}`;
        const values = [job.source, job.source_job_id || null, job.company_raw, job.title_raw, job.posting_url || null, job.apply_url || null, job.location_raw || null, job.city || null, job.campus_year || null, job.recruitment_batch || null, job.employment_type || null, job.published_at || null, job.deadline || null, job.jd_text || null, job.source_confidence || null, job.eligibility?.status || null, job.eligibility?.reason || null, job.pool || null, JSON.stringify(job.score || null)];
        if (existing) { update.run(...values, now, job.fingerprint); updated++; } else { insert.run(id, job.fingerprint, ...values, "discovered", now, now); added++; }
        for (const url of job.source_urls || [job.posting_url]) if (url) sourceInsert.run(id, job.source || "unknown", url);
      }
      return { added, updated };
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

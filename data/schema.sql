CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_job_id TEXT,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  posting_url TEXT,
  apply_url TEXT,
  location TEXT,
  city TEXT,
  campus_year INTEGER,
  recruitment_batch TEXT,
  employment_type TEXT,
  published_at TEXT,
  deadline TEXT,
  jd_text TEXT,
  source_confidence TEXT,
  eligibility_status TEXT,
  eligibility_reason TEXT,
  pool TEXT,
  score_json TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_sources (
  job_id TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (job_id, url),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  job_id TEXT PRIMARY KEY,
  package_path TEXT,
  status TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS blocked_companies (
  name TEXT PRIMARY KEY,
  name_normalized TEXT NOT NULL,
  blocked_at TEXT NOT NULL
);

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../lib/store.mjs";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";
import { validateTransition, transitionStatus } from "../lib/application-tracker.mjs";

function seedStore(dir) {
  const store = openStore(path.join(dir, "jobs.db"));
  const raw = JSON.parse(fs.readFileSync(path.resolve("examples/jobs.fixture.json"), "utf8"));
  const jobs = mergeJobs(raw);
  for (const job of jobs) job.eligibility = classifyEligibility(job);
  store.upsertJobs(jobs);
  return store;
}

test("状态流转规则：只允许前进一格或进入终态", () => {
  assert.equal(validateTransition("discovered", "shortlisted").ok, true);
  assert.equal(validateTransition("discovered", "interview").ok, false);
  assert.equal(validateTransition("applied", "assessment").ok, true);
  assert.equal(validateTransition("offer", "applied").ok, false);
  assert.equal(validateTransition("discovered", "rejected").ok, true);
  assert.equal(validateTransition("rejected", "shortlisted").ok, false);
  assert.equal(validateTransition("offer", "rejected").ok, true);
});

test("完整流转并记录投递时间", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-status-"));
  const store = seedStore(dir);
  const job = store.listJobs({})[0];
  assert.equal(job.status, "discovered");
  for (const status of ["shortlisted", "resume_generated", "ready_for_review"]) {
    transitionStatus({ store, jobId: job.id, to: status });
  }
  transitionStatus({ store, jobId: job.id, to: "applied", packagePath: "output/applications/x" });
  assert.equal(store.listJobs({})[0].status, "applied");
  const app = store.db.prepare("SELECT * FROM applications WHERE job_id = ?").get(job.id);
  assert.ok(app);
  assert.ok(app.applied_at);
  assert.equal(app.package_path, "output/applications/x");
  for (const status of ["assessment", "interview", "offer"]) {
    transitionStatus({ store, jobId: job.id, to: status });
  }
  assert.equal(store.listJobs({})[0].status, "offer");
  store.close();
});

test("非法流转被拒绝", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-status-"));
  const store = seedStore(dir);
  const job = store.listJobs({})[0];
  assert.throws(() => transitionStatus({ store, jobId: job.id, to: "interview" }), /不允许/);
  assert.equal(store.listJobs({})[0].status, "discovered");
  store.close();
});

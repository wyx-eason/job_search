import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("从两份 LaTeX 简历生成未确认事实草稿", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const node = process.execPath;
  const result = spawnSync(node, [path.join(root, "scripts/import-profile.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const facts = fs.readFileSync(path.join(root, "candidate/facts.yml"), "utf8");
  const questions = fs.readFileSync(path.join(root, "candidate/pending-questions.md"), "utf8");
  assert.match(facts, /status: unverified/);
  assert.match(facts, /博世|Bosch/);
  assert.match(questions, /论文目前是已发表/);
});

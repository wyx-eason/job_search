import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runImport } from "../scripts/import-profile.mjs";

test("从两份 LaTeX 简历生成未确认事实草稿", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-profile-"));
  const result = runImport({ profileDir: path.resolve(root, "../profile"), outputDir });
  assert.equal(result.facts >= 1, true);
  const facts = fs.readFileSync(path.join(outputDir, "facts.yml"), "utf8");
  const questions = fs.readFileSync(path.join(outputDir, "pending-questions.md"), "utf8");
  assert.match(facts, /status: unverified/);
  assert.match(facts, /博世|Bosch/);
  assert.match(questions, /论文目前是已发表/);
});

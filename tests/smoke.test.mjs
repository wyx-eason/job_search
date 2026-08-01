import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("项目骨架包含中文规则和核心配置", () => {
  const root = path.resolve(import.meta.dirname, "..");
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(root, "candidate", "preferences.yml")), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(typeof pkg.scripts.test, "string");
});

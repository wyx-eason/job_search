import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplicationPackage } from "../lib/career-ops-bridge.mjs";
import { prepareChromeApplication } from "../lib/chrome-application.mjs";

test("申请包路径稳定且浏览器流程明确不提交", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "campus-app-"));
  const pkg = createApplicationPackage({ id: "A1", company_raw: "示例公司", title_raw: "AI 工程师", jd_text: "2027 届秋招" }, { source: "candidate/" }, root);
  assert.equal(pkg.status, "ready_for_review");
  const flow = prepareChromeApplication({ applyUrl: "https://example.com/apply", packagePath: pkg.packagePath, profileDir: path.join(root, "local/chrome") });
  assert.equal(flow.submitted, false);
  assert.match(flow.actions.at(-1), /最终提交前/);
});

test("拒绝非 HTTPS 申请链接", () => {
  assert.throws(() => prepareChromeApplication({ applyUrl: "http://example.com", packagePath: "x", profileDir: "y" }), /HTTPS/);
});

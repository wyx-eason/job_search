import test from "node:test";
import assert from "node:assert/strict";
import { runResumeQa } from "../lib/resume-qa.mjs";

test("正常简历通过 QA", () => {
  const html = "<html><body><h1>王奕迅</h1><p>13800000000</p><h2>教育背景</h2><h2>实习经历</h2><p>python llm 算法</p></body></html>";
  const qa = runResumeQa({
    html,
    candidate: { name: "王奕迅", phone: "13800000000" },
    keywords: { all: ["python", "llm"] },
    pdfSize: 50000
  });
  assert.equal(qa.ok, true);
});

test("QA 标记 LaTeX 残留和敏感字段", () => {
  const html = "<html><body>\\itemize 身份证号 123 期望薪资 10000</body></html>";
  const qa = runResumeQa({ html, candidate: {}, keywords: { all: [] } });
  assert.equal(qa.ok, false);
  assert.ok(qa.issues.some((i) => i.includes("LaTeX")));
  assert.ok(qa.issues.some((i) => i.includes("敏感")));
});

test("QA 标记未命中任何 JD 关键词与正文过长", () => {
  const html = "<html><body><h1>张三</h1><p>电话</p><h2>教育背景</h2><h2>实习经历</h2>" + "普通内容".repeat(800) + "</body></html>";
  const qa = runResumeQa({
    html,
    candidate: { name: "张三", phone: "电话" },
    keywords: { all: ["java", "自动驾驶"] }
  });
  assert.equal(qa.ok, false);
  assert.ok(qa.issues.some((i) => i.includes("关键词")));
  assert.ok(qa.warnings.some((w) => w.includes("一页")));
});

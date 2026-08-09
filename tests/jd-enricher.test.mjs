import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractJdFromPageText, extractJobTitleFromPageText } from "../lib/jd-enricher.mjs";
import { generateApplicationPackage } from "../lib/application-generator.mjs";

test("从岗位详情页文本提取真实 JD", () => {
  const text = [
    "自动驾驶算法实习生 - VLM/多模态大模型方向",
    "实习|算法类|上海市",
    "申请职位",
    "职位描述",
    "岗位职责",
    "1. 参与基于 VLM/VLA 的自动驾驶感知算法研发",
    "2. 数据闭环构建，利用大模型挖掘高价值 Corner Case",
    "任职要求",
    "1. 硕士及以上学历",
    "2. 熟悉 Python、PyTorch、深度学习",
    "首页/职位列表/职位详情",
    "登录"
  ].join("\n");
  const jd = extractJdFromPageText(text);
  assert.match(jd, /VLM/);
  assert.match(jd, /Python/);
  assert.match(jd, /任职要求/);
  assert.ok(!jd.includes("首页/职位列表"));
});

test("从页面文本提取具体岗位标题", () => {
  const text = ["首页 | 登录", "系统评测工程师", "岗位职责", "1. 负责系统评测", "任职要求", "1. 本科及以上"].join("\n");
  assert.equal(extractJobTitleFromPageText(text), "系统评测工程师");
});

test("标题提取排除表单占位标签（如公司名称）", () => {
  const text = ["首页 | 登录", "公司名称", "系统评测工程师", "岗位职责", "1. 负责系统评测"].join("\n");
  assert.equal(extractJobTitleFromPageText(text), "系统评测工程师");
});

test("mokahr 页面标题提取：识别职位名称标签并排除日期行", () => {
  const text = [
    "首页 | 职位列表 | 招聘动态",
    "职位名称",
    "【2027秋招】系统评测工程师",
    "发布于 2026-07-06",
    "职位描述",
    "【你将参与什么】智驾的评测……",
    "任职要求"
  ].join("\n");
  assert.equal(extractJobTitleFromPageText(text), "系统评测工程师");
});

test("mokahr 单行标签+标题+后续标签场景", () => {
  const text = [
    "首页 | 职位列表 | 招聘动态",
    "校招面试站点校招面试站点-职位名称职位名称【2027秋招】系统评测工程师是否支持外推是否支持外推-",
    "职位描述",
    "【你将参与什么】智驾的评测……",
    "任职要求"
  ].join("\n");
  assert.equal(extractJobTitleFromPageText(text), "系统评测工程师");
});

test("标题提取排除简历板块名（如实习经历）", () => {
  const text = ["首页 | 登录", "实习经历", "教育背景", "岗位职责", "1. 负责系统评测"].join("\n");
  assert.equal(extractJobTitleFromPageText(text), "");
});

test("生成申请包时用真实 JD 而非粗关键词", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-"));
  const job = {
    id: "thin-1",
    company_raw: "示例智驾公司",
    title_raw: "自动驾驶板块、数据智能板块、汽车研发板块等",
    jd_text: "方向：汽车, 自动驾驶 内推码：QFYTUVN 来源：腾讯文档《秋招内推汇总》",
    posting_url: "https://example.com/jobs"
  };
  const enrichJd = async () => ({
    jdText: "岗位职责：负责 LQR 控制参数匹配与 AI Agent 问答系统开发，使用 Python 与 RAG。任职要求：硕士研究生及以上学历，熟悉 LLM、控制算法、自动驾驶。",
    sourceUrl: "https://example.com/jobs/123"
  });
  const result = await generateApplicationPackage({ job, root: tmpRoot, polish: false, enrichJd });
  const report = fs.readFileSync(path.join(result.packagePath, "match-report.md"), "utf8");
  assert.match(report, /llm/i);
  assert.match(report, /rag/i);
  const desc = fs.readFileSync(path.join(result.packagePath, "job-description.md"), "utf8");
  assert.match(desc, /岗位职责/);
  assert.match(desc, /JD 来源/);
  const audit = JSON.parse(fs.readFileSync(path.join(result.packagePath, "generation-audit.json"), "utf8"));
  assert.equal(audit.jdSource, "https://example.com/jobs/123");
});

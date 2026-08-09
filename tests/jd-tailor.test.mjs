import test from "node:test";
import assert from "node:assert/strict";
import { extractJdPoints, buildTailoredHighlights } from "../lib/jd-tailor.mjs";

const jd = "岗位职责：1、负责自动驾驶评测体系设计与指标看板建设，探索 LLM/Agent 自动裁判。2、开发多模态数据管线。任职要求：熟练使用 Python、C++，有 AI 应用开发经验者优先。";

test("从 JD 拆出职责与任职要求要点", () => {
  const { duties, requirements } = extractJdPoints(jd);
  assert.ok(duties.some((d) => d.includes("评测体系")));
  assert.ok(requirements.some((r) => r.includes("Python")));
});

test("针对 JD 要点从真实经历中挑选证据，不编造内容", () => {
  const sections = {
    internship: ["博世实习：设计并实现基于 AI Agent 的 ADAS 控制参数智能问答系统，构建 RAG 检索模块。参与标定。"],
    project: ["飞艇项目：实现 PPO/D3QN 算法，完成多种子评估实验。"],
    skills: ["熟练使用 Python、C++ 进行开发。"],
    education: [],
    honors: [],
    other: []
  };
  const highlights = buildTailoredHighlights({ jdText: jd, sections, keywords: { all: ["评测", "llm", "agent", "python", "c++", "管线", "标定"] } });
  assert.ok(highlights.length > 0);
  const allText = JSON.stringify(sections);
  for (const h of highlights) {
    assert.ok(allText.includes(h.evidence), "证据必须来自真实经历句子");
    assert.match(h.line, /针对「/);
    assert.ok(!h.line.includes("岗位职责：岗位定位"), "要点摘要不应带冗余标签");
  }
});

test("JD 要点在简历中无对应证据时不编造亮点", () => {
  const sections = {
    internship: ["客服实习：接听电话。"],
    project: [],
    skills: [],
    education: [],
    honors: [],
    other: []
  };
  const highlights = buildTailoredHighlights({ jdText: jd, sections, keywords: { all: ["评测", "llm", "agent", "python"] } });
  assert.equal(highlights.length, 0);
});

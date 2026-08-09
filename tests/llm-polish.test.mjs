import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPolishPrompt, polishResumeSections, loadLlmConfig } from "../lib/llm-polish.mjs";

test("润色提示包含 JD 与真实经历要点，且要求不虚构", () => {
  const prompt = buildPolishPrompt({
    jdText: "负责 LLM 智能问答开发",
    sections: { internship: ["博世实习：实现 RAG 检索模块。"], project: [], skills: [] },
    jobTitle: "AI 应用工程师"
  });
  assert.match(prompt, /LLM 智能问答开发/);
  assert.match(prompt, /博世实习：实现 RAG 检索模块/);
  assert.match(prompt, /严禁新增或虚构/);
  assert.match(prompt, /"internship"/);
});

test("润色提示包含用户修改意见", () => {
  const prompt = buildPolishPrompt({
    jdText: "负责 LLM 智能问答开发",
    sections: { internship: ["博世实习：实现 RAG 检索模块。"], project: [], skills: [] },
    jobTitle: "AI 应用工程师",
    userFeedback: "把 RAG 落地细节再展开一点，测试经历放前面"
  });
  assert.match(prompt, /用户反馈/);
  assert.match(prompt, /RAG 落地细节再展开一点/);
  assert.match(prompt, /测试经历放前面/);
  assert.match(prompt, /禁止虚构/);
});

test("润色成功时替换实习/项目/技能板块并保留教育荣誉", async () => {
  const sections = {
    education: ["西安电子科技大学 硕士"],
    internship: ["博世实习：实现 RAG 检索模块。"],
    project: ["飞艇项目：PPO/D3QN。"],
    skills: ["熟练使用 Python。"],
    honors: ["二等奖学金"],
    other: []
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              internship: ["改写后的实习"],
              project: ["改写后的项目"],
              skills: ["改写后的技能"]
            })
          }
        }
      ]
    })
  });
  const { sections: next, meta } = await polishResumeSections({
    jdText: "JD",
    sections,
    config: { apiKey: "k", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    fetchImpl
  });
  assert.equal(meta.ok, true);
  assert.deepEqual(next.internship, ["改写后的实习"]);
  assert.deepEqual(next.education, ["西安电子科技大学 硕士"]);
  assert.deepEqual(next.honors, ["二等奖学金"]);
});

test("Responses 风格：请求 /responses 并以 output_text 解析", async () => {
  const sections = { education: [], internship: ["博世实习：实现 RAG 检索模块。"], project: [], skills: [], honors: [], other: [] };
  let calledUrl = "";
  let calledBody = null;
  const fetchImpl = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ internship: ["改写后的实习"] }) }) };
  };
  const { sections: next, meta } = await polishResumeSections({
    jdText: "JD",
    sections,
    config: { apiKey: "k", baseUrl: "https://2000lab.cc/v1", model: "gpt-5.6-sol", apiStyle: "responses" },
    fetchImpl
  });
  assert.equal(calledUrl, "https://2000lab.cc/v1/responses");
  assert.equal(calledBody.model, "gpt-5.6-sol");
  assert.equal(typeof calledBody.input, "string");
  assert.equal(meta.ok, true);
  assert.deepEqual(next.internship, ["改写后的实习"]);
});

test("润色失败（接口 401）时回退到原始板块", async () => {
  const sections = { education: [], internship: ["原实习"], project: [], skills: [], honors: [], other: [] };
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "invalid key" });
  const { sections: next, meta } = await polishResumeSections({
    jdText: "JD",
    sections,
    config: { apiKey: "bad", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    fetchImpl
  });
  assert.equal(meta.ok, false);
  assert.match(meta.error, /401/);
  assert.deepEqual(next.internship, ["原实习"]);
});

test("未配置 LLM 时不走润色", async () => {
  const sections = { education: [], internship: ["x"], project: [], skills: [], honors: [], other: [] };
  const { sections: next, meta } = await polishResumeSections({ jdText: "JD", sections, config: null });
  assert.equal(meta.enabled, false);
  assert.deepEqual(next.internship, ["x"]);
});

test("loadLlmConfig：enabled=false 或缺少 key 时返回 null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-cfg-"));
  const file = path.join(dir, "llm.json");
  fs.writeFileSync(file, JSON.stringify({ enabled: false, apiKey: "sk-x" }), "utf8");
  assert.equal(loadLlmConfig({ file }), null);
  fs.writeFileSync(file, JSON.stringify({ enabled: true, apiKey: "" }), "utf8");
  assert.equal(loadLlmConfig({ file }), null);
  fs.writeFileSync(file, JSON.stringify({ enabled: true, apiKey: "sk-x", baseUrl: "", model: "" }), "utf8");
  const cfg = loadLlmConfig({ file });
  assert.equal(cfg.apiKey, "sk-x");
  assert.equal(cfg.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(cfg.model, "deepseek-chat");
});

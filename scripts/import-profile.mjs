import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const profileDir = path.resolve(root, "../profile");
const files = ["agent_llm_general_2026.tex", "integration_adas_2026.tex"];

function stripLatex(text) {
  return text
    .replace(/%.*$/gm, "")
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\textit\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^]]*\])?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extract(source, file) {
  const text = stripLatex(source);
  const facts = [];
  const lines = text.split(/\n+/).map((v) => v.trim()).filter(Boolean);
  const interesting = lines.filter((line) => /博世|Bosch|霍莱沃|西安电子科技大学|浙江科技大学|强化学习|飞艇|ROS|ADAS|RAG|Agent|论文|奖学金|智能汽车/.test(line));
  for (const line of interesting) {
    const claim = stripLatex(line.replace(/^\\item\s*/, ""));
    if (claim) facts.push({ id: `claim-${facts.length + 1}`, type: "claim", claim, source: file, status: "unverified" });
  }
  if (!facts.length) facts.push({ id: "source-summary", type: "source", claim: `已读取 ${file}，待人工拆分事实`, source: file, status: "unverified" });
  return facts;
}

function yamlQuote(value) { return JSON.stringify(value); }

function writeFacts(facts) {
  const lines = ["# 由 profile 中的 LaTeX 简历生成；所有条目需用户确认后才能进入定制简历。", "facts:"];
  for (const fact of facts) {
    lines.push(`  - id: ${fact.id}`, `    type: ${fact.type}`, `    claim: ${yamlQuote(fact.claim)}`, `    source: ${fact.source}`, `    status: unverified`);
    if (fact.context) lines.push(`    context: ${yamlQuote(fact.context)}`);
  }
  fs.writeFileSync(path.join(root, "candidate", "facts.yml"), `${lines.join("\n")}\n`, "utf8");
}

function writeQuestions(facts) {
  const questions = ["# 待确认候选人资料", "", "以下内容由原始简历提取，尚未自动视为已掌握。请逐项确认使用深度、具体动作和成果证据。", "", "## 必须确认", "", "- 论文目前是已发表、录用，还是投稿后小修中？", "- 博世 AI 辅助标定工具中，你具体负责了哪些模块？是否有可公开指标？", "- RAG、向量数据库、BM25、Agent 框架分别实际使用到什么程度？", "- 哪些技能只能写“了解”或“基础实践”？", "- 霍莱沃实习中的雷达数据验证和性能测试是否有规模、效率或缺陷指标？", "", "## 自动提取条目", ""];
  for (const fact of facts.filter((v) => v.type !== "section").slice(0, 30)) questions.push(`- [ ] ${fact.id}: ${fact.claim}`);
  fs.writeFileSync(path.join(root, "candidate", "pending-questions.md"), `${questions.join("\n")}\n`, "utf8");
}

const allFacts = [];
for (const file of files) {
  const fullPath = path.join(profileDir, file);
  if (!fs.existsSync(fullPath)) throw new Error(`缺少原始简历: ${fullPath}`);
  allFacts.push(...extract(fs.readFileSync(fullPath, "utf8"), file));
}
writeFacts(allFacts);
fs.writeFileSync(path.join(root, "candidate", "skills.yml"), "# 技能必须经过用户确认；导入阶段统一为 unverified。\nskills: []\n", "utf8");
writeQuestions(allFacts);
console.log(JSON.stringify({ files, facts: allFacts.length, status: "unverified", profileDir }, null, 2));

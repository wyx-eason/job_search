import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATES = new Set(["unverified", "learning", "basic", "practical", "strong"]);

export function validateCandidate({ facts = [], skills = [], preferences = {} }) {
  const errors = [];
  const warnings = [];
  if (!preferences?.candidate?.graduation_date) errors.push("缺少候选人毕业时间");

  for (const skill of skills) {
    if (!STATES.has(skill.status)) {
      errors.push(`技能 ${skill.name || "未命名"} 的状态无效: ${skill.status}`);
      continue;
    }
    const evidence = Array.isArray(skill.evidence) ? skill.evidence.filter(Boolean) : [];
    if (["basic", "practical", "strong"].includes(skill.status) && evidence.length === 0) {
      errors.push(`技能 ${skill.name || "未命名"} 缺少验证证据`);
    }
    if (skill.status === "practical" && !skill.context) errors.push(`技能 ${skill.name || "未命名"} 缺少项目或实习场景`);
    if (skill.status === "strong" && !skill.result && !skill.ownership) errors.push(`技能 ${skill.name || "未命名"} 缺少成果或独立负责证据`);
  }

  for (const fact of facts) {
    const text = `${fact.claim || ""} ${fact.status || ""}`;
    if (/已发表/.test(text) && /小修中/.test(text)) errors.push(`论文事实状态冲突: ${fact.claim}`);
  }
  if (!facts.length) warnings.push("尚未导入候选人事实，简历生成前需要先完成资料核验");
  return { valid: errors.length === 0, errors, warnings };
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const root = path.resolve(import.meta.dirname, "..");
  const result = validateCandidate({ preferences: { candidate: { graduation_date: "2027-06" } } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

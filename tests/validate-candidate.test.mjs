import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidate } from "../lib/validate-candidate.mjs";

const preferences = { candidate: { graduation_date: "2027-06" } };

test("合法的基础和实践技能通过校验", () => {
  const result = validateCandidate({
    preferences,
    skills: [
      { name: "MPC", status: "basic", evidence: ["完成仿真练习"] },
      { name: "Python", status: "practical", context: "科研项目", evidence: ["项目代码"] }
    ]
  });
  assert.equal(result.valid, true);
});

test("非法状态和缺少证据会报错", () => {
  const result = validateCandidate({ preferences, skills: [{ name: "C++", status: "expert" }] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /状态无效/);
});

test("论文已发表和小修中不能同时出现", () => {
  const result = validateCandidate({
    preferences,
    facts: [{ claim: "已发表 SCI 论文一篇（小修中）" }]
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /论文事实状态冲突/);
});

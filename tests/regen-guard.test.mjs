import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoRegenerate, urlKey } from "../lib/regen-guard.mjs";

const jd = "岗位职责：负责自动驾驶算法研发、模型训练与评测，参与数据闭环建设与工具链开发。任职要求：硕士及以上学历，熟悉 Python、PyTorch、深度学习，有强化学习或大模型经验者优先。";

test("非岗位详情文本拒绝重新生成", () => {
  const r = shouldAutoRegenerate({ lastRegen: null, jdText: "算法类、研发工程类、产品类等 内推码：X" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /不是具体岗位详情/);
});

test("JD 未变化不重复生成", () => {
  const r = shouldAutoRegenerate({
    lastRegen: { jdTextNorm: jd.replace(/\s+/g, ""), urlKey: "a" },
    jdText: jd,
    url: "https://app.mokahr.com/x#/job/uuid2"
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /JD 未变化/);
});

test("同一岗位 URL 不重复生成", () => {
  const r = shouldAutoRegenerate({
    lastRegen: { jdTextNorm: "旧", urlKey: urlKey("https://app.mokahr.com/x#/job/uuid") },
    jdText: jd,
    url: "https://app.mokahr.com/x#/job/uuid/apply?share=1"
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /同一岗位/);
});

test("切换不同岗位立即允许重新生成（不受时间冷却影响）", () => {
  const r = shouldAutoRegenerate({
    lastRegen: { jdTextNorm: "旧内容", urlKey: urlKey("https://app.mokahr.com/x#/job/aaa") },
    jdText: jd,
    url: "https://app.mokahr.com/x#/job/bbb/apply"
  });
  assert.equal(r.ok, true);
});

test("自动路径（检测到申请表单）不要求岗位职责标记", () => {
  const r = shouldAutoRegenerate({
    lastRegen: null,
    jdText: "系统评测工程师岗位介绍：负责系统评测、性能测试、缺陷分析与闭环跟踪，制定测试规范与流程，维护测试用例库与自动化脚本。",
    url: "https://app.mokahr.com/x#/home",
    requireMarkers: false
  });
  assert.equal(r.ok, true);
});

test("force 模式（用户提交意见）绕过 JD 未变化与同一岗位限制", () => {
  const lastRegen = { jdTextNorm: jd.replace(/\s+/g, ""), urlKey: urlKey("https://app.mokahr.com/x#/job/uuid") };
  const forced = shouldAutoRegenerate({ lastRegen, jdText: jd, url: "https://app.mokahr.com/x#/job/uuid/apply", force: true });
  assert.equal(forced.ok, true);
  const normal = shouldAutoRegenerate({ lastRegen, jdText: jd, url: "https://app.mokahr.com/x#/job/uuid/apply" });
  assert.equal(normal.ok, false);
  const forcedList = shouldAutoRegenerate({ lastRegen: null, jdText: "算法类、研发工程类等 内推码：X", url: "https://app.mokahr.com/x#/jobs", force: true });
  assert.equal(forcedList.ok, true);
});

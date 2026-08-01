import test from "node:test";
import assert from "node:assert/strict";
import { classifyPool, rankPools } from "../lib/ranking.mjs";

const preferences = {
  locations: { linfen_radius_km: 150 },
  targets: { primary: ["AI 应用", "ADAS"], local_broad: ["控制", "自动化"] }
};

function job(title, city, extra = {}) {
  return { title_raw: title, city, jd_text: "2027 届秋招", source_confidence: "high", eligibility: { status: "eligible" }, ...extra };
}

test("临汾周边和西安进入不同岗位池", () => {
  assert.equal(classifyPool(job("自动化控制工程师", "临汾"), preferences).pool, "linfen_area");
  assert.equal(classifyPool(job("ADAS 算法工程师", "西安"), preferences).pool, "xian_core");
  assert.equal(classifyPool(job("AI 应用工程师", "上海"), preferences).pool, "practice_city");
});

test("排序保留评分原因并把练手岗位限制为单独池", () => {
  const result = rankPools([
    job("AI 应用工程师", "上海", { published_at: "2026-07-31" }),
    job("控制工程师", "临汾"),
    job("ADAS 工程师", "西安"),
    job("未知届别岗位", "西安", { eligibility: { status: "needs_cohort_confirmation" } })
  ], preferences);
  assert.equal(result.linfen_area.length, 1);
  assert.equal(result.xian_core.length, 1);
  assert.equal(result.practice_city.length, 1);
  assert.equal(result.needs_confirmation.length, 1);
  assert.equal(typeof result.xian_core[0].score.total, "number");
});

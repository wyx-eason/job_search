import test from "node:test";
import assert from "node:assert/strict";
import { renderDailyReport } from "../scripts/report.mjs";

test("日报显示三个排序池和来源异常", () => {
  const report = renderDailyReport({ pools: { linfen_area: [], xian_core: [], practice_city: [], needs_confirmation: [] }, failures: ["牛客: 需要登录"] });
  assert.match(report, /临汾周边/); assert.match(report, /西安重点/); assert.match(report, /大城市练手/); assert.match(report, /今日无新增/); assert.match(report, /需要登录/);
});

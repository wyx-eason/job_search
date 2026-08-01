export function renderDailyReport(result, date = new Date().toISOString().slice(0, 10)) {
  const lines = [`# 每日校招岗位摘要 - ${date}`, "", `扫描状态：${result.sourceSummary || "已完成"}`, ""];
  const sections = [["临汾周边", result.pools?.linfen_area || [], 10], ["西安重点", result.pools?.xian_core || [], 10], ["大城市练手", result.pools?.practice_city || [], 5], ["届别待确认", result.pools?.needs_confirmation || [], 20]];
  for (const [name, jobs, limit] of sections) {
    lines.push(`## ${name}`, "");
    if (!jobs.length) { lines.push("今日无新增", ""); continue; }
    for (const job of jobs.slice(0, limit)) lines.push(`- ${job.company_raw || job.company}｜${job.title_raw || job.title}｜${job.city || "地点未知"}｜${job.apply_url || job.posting_url || "无链接"}`);
    lines.push("");
  }
  if (result.failures?.length) { lines.push("## 来源异常", "", ...result.failures.map((v) => `- ${v}`), ""); }
  return `${lines.join("\n")}\n`;
}

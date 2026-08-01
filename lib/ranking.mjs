const XIAN_TERMS = ["西安"];
const LINfEN_TERMS = ["临汾", "侯马", "霍州", "襄汾", "洪洞", "运城", "长治", "晋中"];
const ROLE_TERMS = ["ai", "大模型", "llm", "agent", "rag", "adas", "控制", "自动化", "电气", "仿真", "标定", "机器人", "测试", "设备", "能源"];

function text(job) {
  return `${job.title_raw || job.title || ""} ${job.jd_text || job.description || ""}`.toLowerCase();
}

export function classifyPool(job, preferences = {}) {
  const city = `${job.city || ""}${job.location_raw || ""}`;
  const distance = Number(job.distance_km);
  const radius = Number(preferences?.locations?.linfen_radius_km || 150);
  if (Number.isFinite(distance) && distance <= radius) return { pool: "linfen_area", reason: `估算距离 ${distance} 公里，在临汾范围内` };
  if (LINfEN_TERMS.some((term) => city.includes(term))) return { pool: "linfen_area", reason: "地点属于临汾周边白名单" };
  if (XIAN_TERMS.some((term) => city.includes(term))) return { pool: "xian_core", reason: "地点为西安" };
  return { pool: "practice_city", reason: "其他城市，归入练手池" };
}

export function scoreJob(job, candidate = {}) {
  const body = text(job);
  const targets = [...(candidate?.targets?.primary || []), ...(candidate?.targets?.local_broad || [])].map((v) => v.toLowerCase());
  const targetHits = targets.filter((term) => body.includes(term)).length;
  const roleHits = ROLE_TERMS.filter((term) => body.includes(term)).length;
  const role = Math.min(40, targetHits * 8 + roleHits * 2);
  const location = job.pool === "linfen_area" ? 35 : job.pool === "xian_core" ? 28 : 12;
  const source = job.source_confidence === "high" ? 15 : job.source_confidence === "medium" ? 10 : 5;
  const freshness = job.published_at ? Math.max(0, 10 - Math.floor((Date.now() - new Date(job.published_at).getTime()) / 86400000)) : 3;
  const gap = body.includes("熟练") && !body.includes("了解") ? -Math.min(10, Number(candidate?.estimated_gap_penalty || 3)) : 0;
  return { role, location, freshness, source, gap, total: role + location + freshness + source + gap };
}

export function rankPools(jobs = [], candidate = {}) {
  const pools = { linfen_area: [], xian_core: [], practice_city: [], needs_confirmation: [] };
  for (const job of jobs) {
    if (job.eligibility?.status === "needs_cohort_confirmation") {
      pools.needs_confirmation.push({ ...job, pool: "needs_confirmation" });
      continue;
    }
    if (job.eligibility?.status !== "eligible") continue;
    const classification = classifyPool(job, candidate);
    const scored = { ...job, ...classification, score: scoreJob({ ...job, ...classification }, candidate) };
    pools[classification.pool].push(scored);
  }
  for (const list of Object.values(pools)) list.sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0));
  return pools;
}

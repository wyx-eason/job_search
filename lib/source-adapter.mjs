import { fetchYunJiuyeJobs } from "./adapters/yunjiuye.mjs";
import { fetchSmartCampusAnnounces } from "./adapters/smartcampus.mjs";
import { fetchZggqzpAnnounces } from "./adapters/zggqzp.mjs";
import { fetchQqdocsSheet } from "./adapters/qqdocs.mjs";
import { fetchYingjieshengJobs } from "./adapters/yingjiesheng.mjs";

export const ADAPTERS = {
  yunjiuye: { fetch: fetchYunJiuyeJobs },
  smartcampus: { fetch: fetchSmartCampusAnnounces },
  zggqzp: { fetch: fetchZggqzpAnnounces },
  qqdocs: { fetch: fetchQqdocsSheet },
  yingjiesheng: { fetch: fetchYingjieshengJobs }
};

export async function runSourceAdapters(sources = [], registry = ADAPTERS) {
  const results = [];
  for (const source of sources) {
    const adapter = source?.adapter && registry[source.adapter];
    if (!adapter) {
      results.push({ source: source?.id || "unknown", ok: false, error: "未配置可用适配器" });
      continue;
    }
    try {
      const jobs = await adapter.fetch(source);
      results.push({ source: source.id, ok: true, jobs: jobs || [] });
    } catch (error) {
      results.push({ source: source.id, ok: false, error: error.message });
    }
  }
  return results;
}

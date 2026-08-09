import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../lib/store.mjs";
import { generateApplicationPackage } from "../lib/application-generator.mjs";
import { enrichJobJdWithBrowser } from "../lib/jd-enricher.mjs";

const root = path.resolve(import.meta.dirname, "..");

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const jobId = process.argv[2];
  const verifiedOnly = process.argv.includes("--verified-only");
  if (!jobId) throw new Error("用法: node scripts/generate-application.mjs <jobId> [--verified-only]");
  const store = openStore(path.join(root, "data/jobs.db"));
  const job = store.listJobs({}).find((row) => row.id === jobId);
  store.close();
  if (!job) throw new Error(`未找到岗位: ${jobId}`);
  const result = await generateApplicationPackage({ job, root, verifiedOnly, enrichJd: enrichJobJdWithBrowser });
  console.log(JSON.stringify(result, null, 2));
}

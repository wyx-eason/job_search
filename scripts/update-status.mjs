import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../lib/store.mjs";
import { transitionStatus } from "../lib/application-tracker.mjs";

const root = path.resolve(import.meta.dirname, "..");

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const jobId = process.argv[2];
  const status = process.argv[3];
  if (!jobId || !status) throw new Error("用法: node scripts/update-status.mjs <jobId> <status>");
  const store = openStore(path.join(root, "data/jobs.db"));
  try {
    const result = transitionStatus({ store, jobId, to: status });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

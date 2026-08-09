import fs from "node:fs";
import path from "node:path";
import { generateApplicationPackage } from "./application-generator.mjs";

export async function createApplicationPackage(job, candidate, root = path.resolve(import.meta.dirname, ".."), options = {}) {
  return generateApplicationPackage({ job, root, ...options });
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSmartCampusAnnounce, enrichFromRegistry } from "../lib/adapters/smartcampus.mjs";
import { decodeZggqzp, parseZggqzpAnnounce } from "../lib/adapters/zggqzp.mjs";
import { mergeJobs, classifyEligibility } from "../lib/job-contract.mjs";

test("智慧就业平台公告解析出标题、公司和过期状态", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/smartcampus-sungrow-731143.html"), "utf8");
  const job = parseSmartCampusAnnounce(html, "https://24365.cq.smartedu.cn/campus/view/id/731143");
  assert.equal(job.title, "阳光电源2027届全球校园招聘提前批");
  assert.equal(job.company, "阳光电源股份有限公司");
  assert.equal(job.expired, true);
});

test("智慧就业平台公告解析过期时间", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/smartcampus-xidian-755021.html"), "utf8");
  const job = parseSmartCampusAnnounce(html, "https://job.xidian.edu.cn/campus/view/id/755021");
  assert.equal(job.expiredAt, "2026-04-24");
});

test("智慧就业平台宣讲会详情解析出西安微电子所 2027 提前批", () => {
  const html = fs.readFileSync(path.resolve("tests/fixtures/smartcampus-xianmicro-132152.html"), "utf8");
  const job = parseSmartCampusAnnounce(html, "https://www.cqbys.com/teachin/view/id/132152");
  assert.equal(job.company, "西安微电子技术研究所");
  assert.equal(job.title, "西安微电子技术研究所2027届提前批招聘");
  assert.equal(job.expired, false);
});

test("公司注册表补全缺失的城市信息", () => {
  const registry = JSON.parse(fs.readFileSync(path.resolve("config/companies.json"), "utf8"));
  const job = { company: "西安微电子技术研究所", city: "" };
  enrichFromRegistry(job, registry);
  assert.equal(job.city, "西安");
});

test("国企招聘网公告（GBK）解析出禾赛提前批岗位并通过资格判定", () => {
  const buf = fs.readFileSync(path.resolve("tests/fixtures/zggqzp-hesai-404359.html"));
  const html = decodeZggqzp(buf);
  const job = parseZggqzpAnnounce(html, "https://m.zggqzp.com/2026/zpxx_0723/404359.html");
  assert.equal(job.company, "禾赛科技");
  assert.ok(job.title.includes("2027届"));
  assert.equal(job.deadline, "2026-08-31");
  assert.ok(job.description.includes("控制算法工程师"));
  const normalized = mergeJobs([job])[0];
  assert.equal(classifyEligibility(normalized).status, "eligible");
});

import path from "node:path";

const ALLOWED_PROTOCOLS = new Set(["https:"]);

export function prepareChromeApplication({ applyUrl, packagePath, profileDir }) {
  const url = new URL(applyUrl);
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error("申请链接必须使用 HTTPS");
  if (!packagePath || !profileDir) throw new Error("缺少岗位申请包或 Chrome 配置目录");
  return {
    url: url.toString(),
    packagePath: path.resolve(packagePath),
    profileDir: path.resolve(profileDir),
    actions: ["打开申请页面", "读取公司和岗位", "填写安全字段", "请求确认敏感字段", "上传岗位简历", "停在最终提交前"],
    submitted: false
  };
}

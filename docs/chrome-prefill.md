# Chrome 预填说明

> 2026-09-11 更新：投递页面的默认浏览器已改为 Edge（`config/apply.json` 的 `applyBrowserExecutable` + `applyProfileDir=local/edge-profile/`）；Edge 缺失时回退 Chrome。简历 PDF 与 JD 补全仍用无头 Chrome（`browserExecutable` / `profileDir`）。下文中的 Chrome 流程同样适用于 Edge。

MVP 只生成安全的申请包和浏览器操作清单。后续接入 Chrome 时使用专用用户数据目录 `local/chrome-profile/`，由用户手动登录招聘平台。

允许自动填写联系方式、教育、普通经历、技能、奖项和基于已验证事实生成的岗位回答。身份证号、详细地址、政治面貌、民族、薪资、地点调剂、工作授权、背景调查、真实性声明和电子签名必须逐项确认。

浏览器流程必须在最终提交前停止。系统不保存密码或验证码，不绕过验证码，不批量打招呼，也不点击“提交”“发送”或“申请”。

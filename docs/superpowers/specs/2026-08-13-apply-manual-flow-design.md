# 投递助手手动主流程设计（按当前页面生成简历 + 手动填表）

日期：2026-08-13

## 背景与问题

现有投递助手的核心问题是"自动猜测用户所选岗位"不可靠：

- 多站点（mokahr / vivo / 网易等）的岗位列表、详情、申请表单结构差异大，自动检测常把"列表第一个岗位"或旧标签页当成用户最终选择；
- 检测到岗位详情页后系统自动重生成简历，生成对象往往不是用户真正停留的 JD 页；
- 表单出现后系统自动填写，用户无法控制节奏。

用户确认的目标流程（方案 A，全手动主流程）：

1. 停留在想投的具体岗位 JD 页；
2. 到仪表盘点"按当前页面生成简历"；
3. 在页面上自己点投递，进入申请表单；
4. 到仪表盘点"填表（当前页面）"，系统自动填表并上传简历。

## 目标行为

1. "去投递"只打开浏览器到岗位链接（保留登录态），**不做预生成简历、不自动搜索、不自动选岗**。
2. 用户在浏览器里自行登录、搜索并打开目标岗位 JD 页，停留在此页。
3. 仪表盘"按当前页面生成简历"：
   - 读取**当前活动标签页**的 URL 与页面文字（含 shadow DOM）；
   - 校验页面是具体岗位详情页（页面文字含"岗位职责/职位描述/任职要求"等标记，且存在像岗位标题的行）；
   - 提取岗位标题与 JD，用 LLM（DeepSeek）按 JD 微调生成简历，QA 校验后返回预览；
   - 若当前页不是 JD 页，明确报错"请先打开具体岗位 JD 页"，不拿列表第一项乱生成。
4. 用户在页面上自行点投递，系统不干预、不自动填表。
5. 仪表盘"填表（当前页面）"：
   - 对当前活动标签页执行自动填表：安全字段（姓名/手机/邮箱/学校/学历/专业/毕业时间）+ 自定义字段（自我评价/获奖等）+ 上传本次会话最新生成的简历；
   - 用户手动改过的字段不覆盖；敏感字段跳过待确认；系统不点提交。
6. 关闭自动触发：不再"检测到岗位详情即自动重生成"，不再"检测到表单即自动填表"。
7. "提交意见并重新生成"与"标记已投递"保留。

## 设计

### lib/apply-assistant.mjs

- 新增 `findActivePage(context, fallbackPage)`：
  - 遍历 `context.pages()`，优先 `document.hasFocus() === true` 的页面；
  - 无聚焦页时，取最近一次 URL 变化 / 最后用户交互的页面（复用已有点击/输入跟踪）；
  - 兜底返回会话主页面 `fallbackPage`。
- `startFormWatcher` 增加 `autoFill` 选项（默认 `true`，投递会话传入 `false`）：
  - `autoFill: false` 时停止轮询自动填表与自动上传，仅保留字段/页面检测回调（供状态展示），并关闭"检测到岗位详情自动重生成"路径；
  - 原自动行为代码保留但不再被默认会话触发。
- 保留 `autofillApplyForm`、`uploadResumeToForm`、`getPageInnerText` 等能力，供手动"填表"调用。

### dashboard/server.mjs

- `/api/apply`：
  - 不再预生成申请包（始终按"延后生成"处理）；
  - 启动 watcher 时传 `autoFill: false`；
  - 移除 `onJobDetail` 里的自动 `regenerateForCurrentJob` 调用；
  - 会话提示文案改为四步引导。
- `/api/apply/current-resume`（新端点，即"按当前页面生成简历"）：
  - 读取 `findActivePage(context, session.page)` 的 URL + innerText；
  - `isJobDetailPageText` 校验失败 → 400"请先打开具体岗位 JD 页"；
  - `extractJobTitleFromPageText` + `extractJdFromPageText` 提取标题与 JD；
  - 调 `generateApplicationPackage` 生成申请包（LLM 润色 + QA）；
  - 记录 `session.lastRegen / resumePdfPath / lastJobTitle / lastJdText`；
  - 返回 `packagePath / qa / polish / uploadedFileName`。
- `/api/apply/refill`（改为"填表（当前页面）"）：
  - 目标页改为 `findActivePage(context, session.page)`；
  - 携带 `resumePdfPath: session.resumePdfPath` 与 `formValues` 执行 `autofillApplyForm`。
- `/api/apply/regenerate` 与 `/api/apply/feedback`：
  - `regenerate` 复用 `current-resume` 的当前页逻辑（保持向后兼容）；
  - `feedback` 保持不变（基于 `session.lastJdText` + 用户意见重生成）。

### dashboard/index.html

- 投递会话建立后动作区按钮改为：
  - 主按钮"按当前页面生成简历"（调用 `/api/apply/current-resume`）；
  - "填表（当前页面）"（调用 `/api/apply/refill`）；
  - 保留"预览简历 / 打开申请包目录 / 标记已投递 / 提交意见并重新生成"。
- 状态文案改为四步引导，移除自动重生成轮询提示。

## 边界与错误处理

- 当前活动页不是 JD 页：提示打开具体岗位页（页面需含 JD 标记行与类岗位标题行）。
- 当前页无表单：填表返回"未检测到可填写的申请表单"。
- 生成简历时正在生成（防并发）：沿用 `session.regenLock` 队列。
- 填表时简历尚未生成：只填字段并提示"请先生成简历再填表（或手动上传）"。
- 用户手改字段：`__userTouched` 机制保留，不覆盖。
- 多标签页：`findActivePage` 以 `hasFocus` 判定当前活动页。

## 测试

- `findActivePage`：聚焦页优先、无聚焦时回退逻辑（mock 多页面）。
- `/api/apply/current-resume`：非 JD 页返回明确错误；JD 页走通生成（mock LLM/QA）。
- `/api/apply/refill`：目标页为当前活动页（mock），且携带最新 `resumePdfPath`。
- watcher `autoFill: false`：检测到表单后不自动填表、不自动重生成。
- 回归：运行 `node --test`，确认既有 ATS 导航、简历生成、仪表盘接口行为无回退。

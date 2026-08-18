# 投递周报：已投递公司列表设计

## 背景

仪表盘当前只能看到“已投递 / 测评中 / 面试中 / Offer”等数字统计，无法直接看到具体投递过哪些公司。用户希望在“投递周报”区块中新增一个默认折叠的已投递公司列表，用于快速确认当前活跃的投递。

## 目标行为

1. 在“投递周报”区块内、状态 chips 下方显示一个默认折叠的子列表，标题为“已投递公司（N）”。
2. 展开后每行显示：公司 · 岗位 · 投递日期 · 当前状态徽标。
3. 列表只包含当前活跃的投递：已投递、测评中、面试中、Offer；已拒绝、已撤回、已过期、已丢弃不显示。
4. 按投递时间倒序排列，最新投递在最上面。
5. 没有活跃投递时，不渲染该子列表，避免出现“已投递公司（0）”。
6. 折叠状态与页面其它折叠区块一致，使用 localStorage 记忆。

## 数据来源

`applications` 表已记录所有投递过的岗位：

- `job_id`
- `package_path`
- `status`
- `applied_at`

岗位公司名、岗位名、城市、当前状态来自 `jobs` 表。

## 后端改动

修改 `dashboard/api.mjs` 的 `loadDashboardData`：

1. 读取 `applications` 表后，过滤出当前状态属于活跃集合的投递：

   ```js
   const ACTIVE_APPLIED_STATUSES = ["applied", "assessment", "interview", "offer"];
   ```

2. 为每条活跃投递生成视图：

   ```js
   {
     jobId,
     company,
     title,
     city,
     status,
     statusLabel,
     appliedAt
   }
   ```

3. 按 `applied_at` 倒序排序，放入返回对象的 `weekly.appliedJobs`。

## 前端改动

修改 `dashboard/index.html`：

1. 在“投递周报”的 `sec-body` 内、`weeklyStats` 下方新增容器：

   ```html
   <div class="sub-collapsible" id="appliedJobsWrap">
     <h3 class="sec-head"><span class="arrow">▸</span>已投递公司 <span id="appliedJobsCount" class="muted"></span></h3>
     <div class="sec-body" id="appliedJobs"></div>
   </div>
   ```

2. `main()` 中根据 `data.weekly.appliedJobs` 渲染列表：

   - 空数组时隐藏 `appliedJobsWrap`。
   - 非空时显示，默认折叠，点击标题可展开/收起。
   - 每行格式：公司 · 岗位 · 投递日期 · 状态徽标。
   - 状态徽标文本复用现有 `LABELS`，新增 `.status-badge` 轻量样式（灰底圆角小标签）。

3. 折叠状态键使用 `applied_jobs`，并加入 `DEFAULT_COLLAPSED` 为 `true`。

## 错误处理

- 接口异常时页面现有 `main().catch` 逻辑统一提示加载失败。
- 如果某条活跃投递对应的岗位已从 `jobs` 表删除，则该条跳过，避免渲染空公司名。

## 测试

在 `tests/dashboard.test.mjs` 中增加用例：

1. 构造含活跃投递（applied / interview）和终态投递（rejected）的数据。
2. 断言 `/api/dashboard` 返回 `weekly.appliedJobs`。
3. 断言活跃投递在列表中，终态投递不在列表中。
4. 断言列表按投递时间倒序排列。
5. 断言没有活跃投递时 `weekly.appliedJobs` 为空数组。

## 范围外

- 不做点击跳转、筛选或导出。
- 不改动岗位状态流转逻辑。
- 不新增数据库表。

# 每日扫描说明

默认每天北京时间 08:00 执行公开岗位扫描。当前 MVP 支持本地 JSON 岗位源，用于验证标准化、届别筛选、去重和排序；登录型网站需要后续通过 Chrome 交互补充。

手动运行：

```powershell
node scripts/daily-scan.mjs examples/jobs.fixture.json
```

Windows 定时任务命令由以下命令打印，系统不会未经确认修改任务计划程序：

```powershell
node scripts/print-schedule-command.mjs
```

报告写入 `reports/daily/YYYY-MM-DD.md`。单一来源失败会记录在“来源异常”中，不会阻塞其他来源。

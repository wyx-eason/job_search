console.log('schtasks /Create /SC DAILY /TN "ChinaCampusOpsDailyScan" /ST 08:00 /TR "node E:\\job_search\\china-campus-ops\\scripts\\daily-scan.mjs"');

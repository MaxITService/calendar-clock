# Calendar fixtures

Test-only scripts use the logged-in CFT Google Calendar page. Creation clones one fresh internal `sync.sync` mutation template; cleanup opens only exact fixture IDs through Calendar's own event editor. They do not use OAuth credentials or production extension hooks.

```powershell
.\test\calendar-fixtures\Invoke-TodayCalendarFixtures.ps1 -Action List
.\test\calendar-fixtures\Invoke-TodayCalendarFixtures.ps1 -Action Add
.\test\calendar-fixtures\Invoke-TodayCalendarFixtures.ps1 -Action Reset
.\test\calendar-fixtures\Invoke-TodayCalendarFixtures.ps1 -Action Remove
```

The date comes from the Calendar page, so the commands always target today in the browser's timezone. Add refuses duplicates. Remove only touches events whose title begins with the exact date marker `[CC FIXTURE v1 YYYY-MM-DD]`.

For a one-off schedule, keep the JSON in `.agents/` and pass `-ConfigPath`:

```powershell
.\test\calendar-fixtures\Invoke-TodayCalendarFixtures.ps1 -Action Reset -ConfigPath .agents\today-fixtures.json
```

The default `fixtures.json` intentionally includes overlaps, a short event, and an overnight event for edge-case testing.

Requirements: CFT on port `9223`, Browser Harness target `cfttest`, and a logged-in Calendar tab. The adapter fails closed when Google's private mutation schema changes.

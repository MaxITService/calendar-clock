# Clock Display Requirements

- The clock always represents today's real time, not the currently viewed Google Calendar date.
- The active clock window decides which dates are needed; crossing midnight may require yesterday/today or today/tomorrow.
- Google Calendar views only scan and update stored events by date; changing views must not move the clock date.
- The clock displays stored events whose real date/time overlaps the active clock window.
- Missing adjacent-day events should be solved by scanning that date/week and remembering the result.

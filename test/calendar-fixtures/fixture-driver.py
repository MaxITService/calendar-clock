"""Runs inside Browser Harness; use Invoke-TodayCalendarFixtures.ps1."""
import base64
import json
import os
import urllib.parse
from datetime import datetime, timedelta

HOOK_API = "__calendarClockFixtureHook"
CALENDAR_URL = "https://calendar.google.com/calendar/u/0/r/week"


def page_json(expression):
    return js(expression)


def install_hook(source):
    cdp("Page.addScriptToEvaluateOnNewDocument", source=source)
    page_json(source)


def wait_for(predicate, message, attempts=20, delay=0.5):
    for _ in range(attempts):
        if predicate():
            return
        wait(delay)
    raise RuntimeError(message)


def page_today():
    return page_json("""(() => [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, '0'),
      String(new Date().getDate()).padStart(2, '0')
    ].join('-'))()""")


def fixture_records(config, date_text):
    day = datetime.strptime(date_text, "%Y-%m-%d").date()
    prefix = f"[CC FIXTURE v1 {date_text}]"
    records = []
    for item in config["events"]:
        start_hour, start_minute = map(int, item["start"].split(":"))
        end_hour, end_minute = map(int, item["end"].split(":"))
        end_day = day + timedelta(days=int(item.get("endDayOffset", 0)))
        start_ms = page_json(
            f"new Date({day.year},{day.month - 1},{day.day},{start_hour},{start_minute},0,0).getTime()"
        )
        end_ms = page_json(
            f"new Date({end_day.year},{end_day.month - 1},{end_day.day},{end_hour},{end_minute},0,0).getTime()"
        )
        records.append({
            "name": item["name"],
            "title": f"{prefix} {item['title']}",
            "startMs": start_ms,
            "endMs": end_ms,
            "startLocal": f"{day:%Y%m%d}T{start_hour:02d}{start_minute:02d}00",
            "endLocal": f"{end_day:%Y%m%d}T{end_hour:02d}{end_minute:02d}00",
        })
    return prefix, records


def list_fixtures(prefix):
    return page_json(f"window.{HOOK_API}.listDomFixtures({json.dumps(prefix)})")


def refresh_calendar():
    goto_url(CALENDAR_URL)
    wait_for_load()
    wait(3)


def add_fixtures(prefix, records):
    existing = list_fixtures(prefix)
    if existing:
        raise RuntimeError(f"{len(existing)} fixtures already exist for this date; use Reset or Remove first.")

    bootstrap = records[0]
    query = urllib.parse.urlencode({
        "text": bootstrap["title"],
        "dates": f"{bootstrap['startLocal']}/{bootstrap['endLocal']}",
        "details": "calendar-clock-fixture:v1; safe to delete"
    })
    goto_url(f"https://calendar.google.com/calendar/u/0/r/eventedit?{query}")
    wait_for_load()
    wait_for(lambda: page_json("document.body.innerText.includes('Loaded')"), "Calendar event editor did not finish loading.")
    page_json("""(() => {
      const root = document.querySelector('#calendar-clock-root');
      if (root) root.style.display = 'none';
      const save = [...document.querySelectorAll('button,[role=button]')].find(node => node.textContent.trim() === 'Save');
      if (!save) throw new Error('Calendar Save button not found.');
      save.click();
      return true;
    })()""")
    wait_for(lambda: "/eventedit" not in page_info()["url"], "Calendar did not save the bootstrap fixture.")
    wait_for(
        lambda: page_json(f"window.{HOOK_API}?.status().hasCreateTemplate === true"),
        "Calendar create mutation was not captured; internal schema may have changed."
    )

    remaining = [{key: value for key, value in record.items() if key in ("title", "startMs", "endMs")} for record in records[1:]]
    if remaining:
        result = page_json(
            f"window.{HOOK_API}.createFromCapturedTemplate({json.dumps(remaining)}).then(value => value)"
        )
        if result.get("status") != 200:
            raise RuntimeError(f"Calendar fixture batch returned {result!r}")

    refresh_calendar()
    created = list_fixtures(prefix)
    if len(created) != len(records):
        raise RuntimeError(f"Expected {len(records)} fixtures after add, found {len(created)}.")
    print(json.dumps({"action": "add", "prefix": prefix, "count": len(created)}, ensure_ascii=False))


def editor_is_loaded():
    return page_json("document.body.innerText.includes('Loaded')")


def open_editor_actions():
    return page_json("""(() => {
      const root = document.querySelector('#calendar-clock-root');
      if (root) root.style.display = 'none';
      const button = [...document.querySelectorAll('button,[role=button]')]
        .find(node => node.textContent.includes('More actions'));
      if (!button) return false;
      button.click();
      return true;
    })()""")


def click_editor_delete():
    return page_json("""(() => {
      const item = [...document.querySelectorAll('[role=menuitem],[role=option]')]
        .find(node => node.textContent.trim() === 'Delete');
      if (!item) return false;
      item.click();
      return true;
    })()""")


def remove_fixtures(prefix):
    fixtures = list_fixtures(prefix)
    if not fixtures:
        print(json.dumps({"action": "remove", "prefix": prefix, "count": 0}, ensure_ascii=False))
        return

    for fixture in fixtures:
        goto_url(f"https://calendar.google.com/calendar/u/0/r/eventedit/{urllib.parse.quote(fixture['rawId'], safe='')}")
        wait_for_load()
        wait_for(editor_is_loaded, "Calendar fixture editor did not finish loading.")
        if not open_editor_actions():
            raise RuntimeError("Calendar fixture actions menu was not found.")
        wait_for(click_editor_delete, "Calendar fixture Delete action did not appear.")
        wait_for(lambda: "/eventedit" not in page_info()["url"], "Calendar did not delete a fixture.")

    refresh_calendar()
    leftover = list_fixtures(prefix)
    if leftover:
        raise RuntimeError(f"Expected zero fixtures after remove, found {len(leftover)}.")
    print(json.dumps({"action": "remove", "prefix": prefix, "count": len(fixtures)}, ensure_ascii=False))


def main():
    action = os.environ.get("CC_FIXTURE_ACTION", "List").lower()
    hook_source = base64.b64decode(os.environ["CC_FIXTURE_HOOK_B64"]).decode("utf-8")
    config = json.loads(base64.b64decode(os.environ["CC_FIXTURE_CONFIG_B64"]).decode("utf-8"))

    if not page_info()["url"].startswith("https://calendar.google.com/"):
        goto_url(CALENDAR_URL)
        wait_for_load()
    install_hook(hook_source)
    prefix, records = fixture_records(config, page_today())

    if action == "list":
        print(json.dumps({"action": "list", "prefix": prefix, "fixtures": list_fixtures(prefix)}, ensure_ascii=False))
    elif action == "add":
        add_fixtures(prefix, records)
    elif action == "remove":
        remove_fixtures(prefix)
    elif action == "reset":
        remove_fixtures(prefix)
        add_fixtures(prefix, records)
    else:
        raise RuntimeError(f"Unknown fixture action: {action}")


main()

// Fake event scenarios for the design mock. Times are day minutes; "now"-relative
// scenarios use offsets from the current time so proximity presentation can be tested.
(function defineDesignMockScenarios() {
    "use strict";

    const H = 60;
    const t = (hours, minutes = 0) => hours * H + minutes;

    function ev(title, start, end, extra = {}) {
        return { title, start, end, ...extra };
    }

    function point(title, at, extra = {}) {
        return { title, start: at, end: at, kind: "point", ...extra };
    }

    function rel(title, startOffset, endOffset, extra = {}) {
        return { title, relStart: startOffset, relEnd: endOffset, ...extra };
    }

    const SCENARIOS = {
        workday: {
            name: "Busy workday",
            events: [
                ev("Standup", t(9), t(9, 15)),
                ev("Design review: side plate labels", t(9, 30), t(10, 30)),
                ev("Focus block", t(10, 30), t(12)),
                ev("Lunch with Anna", t(12), t(13)),
                ev("1:1 with manager", t(13), t(13, 30)),
                ev("Sprint planning for the next two weeks", t(14), t(15, 30)),
                ev("Dentist", t(16), t(17)),
                ev("Gym", t(18), t(19)),
                point("Call bank", t(11)),
                point("Submit timesheet", t(17, 30)),
            ],
        },
        longTitles: {
            name: "Long titles",
            events: [
                ev("Quarterly business review with the entire leadership team and external partners", t(8, 30), t(10)),
                ev("Architecture discussion: migrating the event capture pipeline to structured page-owned responses", t(10, 15), t(11)),
                ev("Coffee", t(11), t(11, 15)),
                ev("Interview: senior front-end engineer (panel round two, whiteboard)", t(11, 30), t(12, 30)),
                ev("Parent-teacher conference at the school on Maple Street, room 204", t(13), t(13, 45)),
                ev("Write up", t(14), t(14, 20)),
                ev("Release readiness checklist walkthrough for the mobile and desktop teams", t(15), t(16, 30)),
                ev("Retro", t(17), t(17, 30)),
                ev("Dinner reservation at that new Georgian place downtown", t(19), t(20)),
            ],
        },
        overlapping: {
            name: "Overlapping lanes",
            events: [
                ev("All-hands", t(9), t(11)),
                ev("Hiring sync", t(9, 30), t(10)),
                ev("Vendor call about the contract renewal", t(9, 45), t(10, 45)),
                ev("Deep work", t(11), t(14)),
                ev("Lunch", t(12), t(13)),
                ev("Product sync", t(12, 30), t(13, 15)),
                ev("Bug triage", t(13), t(13, 30)),
                ev("Customer escalation bridge", t(14), t(15)),
                ev("Customer escalation follow-up", t(14, 30), t(15, 30)),
                ev("Kids pickup", t(16), t(16, 30)),
                ev("Evening study", t(17, 30), t(19, 30)),
                ev("Podcast recording", t(18), t(19)),
            ],
        },
        sparse: {
            name: "Sparse day",
            events: [
                ev("Morning run", t(8), t(8, 45)),
                ev("Board prep", t(13), t(14)),
                ev("Theatre: Hamlet at the National", t(19), t(20)),
            ],
        },
        crowded: {
            name: "Crowded (20 events)",
            events: Array.from({ length: 20 }, (_, index) => {
                const start = t(8) + index * 36;
                const titles = [
                    "Sync", "Planning", "Review", "Backlog grooming", "Pairing session",
                    "Security audit walkthrough", "Roadmap", "Design crit", "Demo", "Support rota",
                ];
                return ev(`${titles[index % titles.length]} ${index + 1}`, start, start + 30);
            }),
        },
        aroundNow: {
            name: "Around now (proximity)",
            events: [
                rel("Just finished", -90, -30),
                rel("Happening right now: weekly team sync", -20, 25),
                rel("Starting soon", 15, 60),
                rel("Point in 10 min", 10, 10, { kind: "point" }),
                rel("Later today: strategy workshop", 120, 200),
                rel("Much later", 300, 340),
                rel("Earlier this morning", -240, -180),
            ],
        },
        tasks: {
            name: "Tasks and points",
            events: [
                point("Pay invoice", t(9)),
                point("Water plants", t(9, 5)),
                point("Reply to legal", t(12, 30), { task: true }),
                point("Book flights for the conference in Lisbon", t(15), { task: true }),
                ev("Workshop", t(10), t(12)),
                point("Push release", t(17)),
                point("Pick up parcel", t(17, 10)),
            ],
        },
    };

    const COLORS = [
        "#1a73e8", "#0b8043", "#8e24aa", "#e67c73", "#f6bf26", "#f4511e",
        "#039be5", "#3f51b5", "#33b679", "#c23b7a", "#6e553d", "#d50000",
    ];

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function minutesToTime(minutes) {
        const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
        return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
    }

    function nowDayMinutes(timeZone) {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date());
        const hour = Number(parts.find(part => part.type === "hour")?.value) || 0;
        const minute = Number(parts.find(part => part.type === "minute")?.value) || 0;
        return hour * 60 + minute;
    }

    // Projects scenario rows into events carrying a valid temporal contract for the given day.
    function buildScenarioEvents(scenarioId, temporalApi, context, dateKey) {
        const scenario = SCENARIOS[scenarioId] || SCENARIOS.workday;
        const now = nowDayMinutes(context.calendarTimeZone);
        const projected = [];

        scenario.events.forEach((row, index) => {
            const start = row.relStart !== undefined ? now + row.relStart : row.start;
            const end = row.relEnd !== undefined ? now + row.relEnd : row.end;
            const isPoint = row.kind === "point";
            const result = temporalApi.projectZonedEvent({
                id: `mock-${scenarioId}-${index}`,
                domKey: `mock-${scenarioId}-${index}`,
                title: row.title,
                calendarName: row.task ? "Tasks" : "Design Mock",
                color: row.color || COLORS[index % COLORS.length],
                durationKind: isPoint ? "point" : "range",
                capturedFrom: row.task ? "google-tasks-dom" : "google-calendar-dom",
                itemKind: row.task ? "task" : "event",
                startDateKey: dateKey,
                startTime: minutesToTime(start),
                endDateKey: dateKey,
                endTime: minutesToTime(isPoint ? start : Math.max(start + 1, end)),
            }, context);
            if (result.ok) projected.push(result.value);
            else console.warn("[design-mock] rejected scenario event", row.title, result.diagnostic);
        });

        return projected;
    }

    globalThis.CalendarClockDesignMockScenarios = Object.freeze({
        SCENARIOS,
        buildScenarioEvents,
    });
})();

const SUPPORTED_VIEW_DATE_COUNTS = Object.freeze({
  day: 1,
  workweek: 5,
  week: 7
});

const LANE_NAMES = Object.freeze(["timed", "allDay"]);

export const OUTLOOK_PRESENCE_POLICY_DEFAULTS = Object.freeze({
  quietPeriodMs: 1000,
  minimumObservations: 3,
  minimumObservationGapMs: 750,
  minimumObservationSpanMs: 1500,
  maximumObservationGapMs: 5000,
  animationRetryMs: 200,
  maximumTrackedIds: 200
});

function boundedInteger(value, fallback, minimum, maximum) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.min(maximum, Math.max(minimum, normalized))
    : fallback;
}

function normalizeConfiguration(configuration = {}) {
  const minimumObservationGapMs = boundedInteger(
    configuration.minimumObservationGapMs,
    OUTLOOK_PRESENCE_POLICY_DEFAULTS.minimumObservationGapMs,
    100,
    10_000
  );
  return Object.freeze({
    quietPeriodMs: boundedInteger(configuration.quietPeriodMs, OUTLOOK_PRESENCE_POLICY_DEFAULTS.quietPeriodMs, 0, 10_000),
    minimumObservations: boundedInteger(configuration.minimumObservations, OUTLOOK_PRESENCE_POLICY_DEFAULTS.minimumObservations, 2, 10),
    minimumObservationGapMs,
    minimumObservationSpanMs: boundedInteger(configuration.minimumObservationSpanMs, OUTLOOK_PRESENCE_POLICY_DEFAULTS.minimumObservationSpanMs, 100, 30_000),
    maximumObservationGapMs: Math.max(
      minimumObservationGapMs,
      boundedInteger(configuration.maximumObservationGapMs, OUTLOOK_PRESENCE_POLICY_DEFAULTS.maximumObservationGapMs, 500, 60_000)
    ),
    animationRetryMs: boundedInteger(configuration.animationRetryMs, OUTLOOK_PRESENCE_POLICY_DEFAULTS.animationRetryMs, 50, 2_000),
    maximumTrackedIds: boundedInteger(configuration.maximumTrackedIds, OUTLOOK_PRESENCE_POLICY_DEFAULTS.maximumTrackedIds, 1, 200)
  });
}

function normalizeBoundedIdSet(values, limit) {
  const normalized = new Set();
  if (!values || typeof values[Symbol.iterator] !== "function") {
    return { values: normalized, overflow: false };
  }
  for (const value of values) {
    const id = String(value || "").slice(0, 256).trim();
    if (id) normalized.add(id);
    if (normalized.size > limit) return { values: new Set(), overflow: true };
  }
  return { values: normalized, overflow: false };
}

function normalizePresentIdSet(values, expectedIds) {
  const normalized = new Set();
  if (!values || typeof values[Symbol.iterator] !== "function") return normalized;
  for (const value of values) {
    const id = String(value || "").slice(0, 256).trim();
    if (id && expectedIds.has(id)) normalized.add(id);
    if (normalized.size >= expectedIds.size) break;
  }
  return normalized;
}

function makeDecision(
  status,
  reason,
  suppressedIds = [],
  nextObservationDelayMs = null,
  scope = "",
  observation = {}
) {
  const normalizedDelay = Number.isFinite(nextObservationDelayMs)
    ? Math.max(0, Math.round(nextObservationDelayMs))
    : null;
  return Object.freeze({
    status,
    reason: String(reason || "").slice(0, 240),
    scope: String(scope || "").slice(0, 500),
    suppressedIds: Object.freeze(Array.from(suppressedIds).sort()),
    nextObservationDelayMs: normalizedDelay,
    sourceInstanceId: String(observation.sourceInstanceId || "").slice(0, 100),
    observationSequence: Math.max(0, Math.round(Number(observation.observationSequence) || 0))
  });
}

function getCommonIneligibilityReason(observation) {
  const expectedDateCount = SUPPORTED_VIEW_DATE_COUNTS[observation?.viewMode];
  if (!expectedDateCount) return "unsupported Outlook view";
  if (observation.captureTrusted !== true
      || observation.routeDateConsistent !== true
      || !Array.isArray(observation.visibleDateKeys)
      || observation.visibleDateKeys.length !== expectedDateCount) {
    return "visible DOM date scope is not authoritative";
  }
  if (observation.documentVisible !== true) return "document visibility is not visible";
  if (observation.trackingReady !== true) return "presence activity tracking is unavailable";
  if (observation.calendarVisibilityTrusted !== true || !observation.calendarVisibilityKey) {
    return "calendar visibility coverage is unproven";
  }
  if (!observation.apiRevision) return "structured snapshot revision is unknown";
  if (!observation.recordsRevision) return "structured record set is unknown";
  if (!observation.displayTimeZoneKey) return "Outlook display timezone is unknown";
  if (!observation.scopeKey) return "render scope is unknown";
  if (observation.animationsKnown !== true) return "animation state is unknown";
  if (observation.animationCount > 0) return "Outlook render animation is active";
  if (observation.busyState !== "idle") return "Outlook interaction or loading state is not proven idle";
  if (!Number.isFinite(observation.activityRevision)
      || !Number.isFinite(observation.lastActivityAt)
      || !Number.isFinite(observation.now)) {
    return "render activity epoch is unavailable";
  }
  return "";
}

function getLaneIneligibilityReason(laneName, lane) {
  if (lane?.trusted !== true) return `${laneName} lane coverage is unproven`;
  if (lane.identityComplete !== true) return `${laneName} lane identity mapping is ambiguous`;
  if (!lane.surfaceKey || !lane.geometryKey || !lane.coverageProfileKey) {
    return `${laneName} lane surface profile is unknown`;
  }
  if (laneName === "allDay" && lane.overflow !== false) return "all-day lane may be clipped";
  return "";
}

function makeLaneState() {
  return {
    signature: "",
    evidenceById: new Map()
  };
}

function makeLaneSignature(laneName, lane) {
  return [
    laneName,
    lane?.trusted === true,
    lane?.identityComplete === true,
    lane?.surfaceKey || "",
    lane?.geometryKey || "",
    lane?.coverageProfileKey || "",
    laneName === "allDay" ? lane?.overflow === false : true
  ].join("|");
}

export class OutlookPresenceSuppressionPolicy {
  constructor(configuration = {}) {
    this.configuration = normalizeConfiguration(configuration);
    this.sourceInstanceId = "";
    this.lastObservationSequence = 0;
    this.lastObservationNow = 0;
    this.scope = "";
    this.activityRevision = null;
    this.lastResetAt = 0;
    this.lanes = {
      timed: makeLaneState(),
      allDay: makeLaneState()
    };
  }

  reset() {
    this.sourceInstanceId = "";
    this.lastObservationSequence = 0;
    this.lastObservationNow = 0;
    this.resetEvidence(0);
  }

  resetEvidence(now) {
    this.scope = "";
    this.activityRevision = null;
    this.lastResetAt = Math.max(0, Number(now) || 0);
    LANE_NAMES.forEach(laneName => {
      this.lanes[laneName] = makeLaneState();
    });
  }

  clearEvidence(now = this.lastResetAt) {
    this.lastResetAt = Math.max(this.lastResetAt, Number(now) || 0);
    LANE_NAMES.forEach(laneName => {
      this.lanes[laneName].evidenceById.clear();
    });
  }

  acceptObservationCursor(observation) {
    const sourceInstanceId = String(observation?.sourceInstanceId || "").slice(0, 100).trim();
    const sequence = Math.round(Number(observation?.observationSequence));
    const now = Number(observation?.now);
    if (!sourceInstanceId || !Number.isInteger(sequence) || sequence <= 0 || !Number.isFinite(now)) {
      return "fresh observation identity is unavailable";
    }
    if (this.sourceInstanceId && sourceInstanceId === this.sourceInstanceId
        && (sequence <= this.lastObservationSequence || now < this.lastObservationNow)) {
      this.resetEvidence(now);
      this.lastObservationSequence = Math.max(this.lastObservationSequence, sequence);
      this.lastObservationNow = Math.max(this.lastObservationNow, now);
      return "observation sequence is stale or non-monotonic";
    }
    if (sourceInstanceId !== this.sourceInstanceId) {
      this.resetEvidence(now);
      this.sourceInstanceId = sourceInstanceId;
      this.lastObservationSequence = 0;
      this.lastObservationNow = 0;
    }
    this.lastObservationSequence = sequence;
    this.lastObservationNow = now;
    return "";
  }

  observe(observation = {}) {
    const cursorReason = this.acceptObservationCursor(observation);
    if (cursorReason) return makeDecision("inactive", cursorReason, [], null, "", observation);

    const commonReason = getCommonIneligibilityReason(observation);
    if (commonReason) {
      this.resetEvidence(observation.now);
      const retryDelay = observation.animationsKnown === true && observation.animationCount > 0
        ? this.configuration.animationRetryMs
        : null;
      return makeDecision("inactive", commonReason, [], retryDelay, "", observation);
    }

    const scope = [
      observation.scopeKey,
      observation.calendarVisibilityKey,
      observation.apiRevision,
      observation.recordsRevision,
      observation.displayTimeZoneKey
    ].map(value => String(value || "")).join("|");
    const laneSignatures = Object.fromEntries(LANE_NAMES.map(laneName => [
      laneName,
      makeLaneSignature(laneName, observation.lanes?.[laneName])
    ]));
    const resetRequired = this.scope !== scope
      || this.activityRevision !== observation.activityRevision
      || LANE_NAMES.some(laneName => this.lanes[laneName].signature !== laneSignatures[laneName]);
    if (resetRequired) {
      this.clearEvidence(observation.now);
      this.scope = scope;
      this.activityRevision = observation.activityRevision;
      LANE_NAMES.forEach(laneName => {
        this.lanes[laneName].signature = laneSignatures[laneName];
      });
    }

    const settleUntil = Math.max(observation.lastActivityAt, this.lastResetAt) + this.configuration.quietPeriodMs;
    if (observation.now < settleUntil) {
      this.clearEvidence(this.lastResetAt);
      return makeDecision(
        "observing",
        "waiting for Outlook render quiet period",
        [],
        settleUntil - observation.now,
        scope,
        observation
      );
    }

    const suppressedIds = new Set();
    const laneReasons = [];
    let nextObservationDelayMs = null;
    let missingCandidateCount = 0;

    LANE_NAMES.forEach(laneName => {
      const lane = observation.lanes?.[laneName] || {};
      const laneState = this.lanes[laneName];
      const laneReason = getLaneIneligibilityReason(laneName, lane);
      if (laneReason) {
        laneState.evidenceById.clear();
        laneReasons.push(laneReason);
        return;
      }

      const expectedResult = normalizeBoundedIdSet(lane.expectedIds, this.configuration.maximumTrackedIds);
      if (expectedResult.overflow) {
        laneState.evidenceById.clear();
        laneReasons.push(`${laneName} lane exceeds bounded evidence capacity`);
        return;
      }
      const expectedIds = expectedResult.values;
      const presentIds = normalizePresentIdSet(lane.presentIds, expectedIds);
      Array.from(laneState.evidenceById.keys()).forEach(id => {
        if (!expectedIds.has(id) || presentIds.has(id)) laneState.evidenceById.delete(id);
      });

      expectedIds.forEach(id => {
        if (presentIds.has(id)) return;
        missingCandidateCount += 1;
        let evidence = laneState.evidenceById.get(id);
        if (!evidence) {
          evidence = {
            count: 1,
            firstObservedAt: observation.now,
            lastObservedAt: observation.now,
            lastObservationSequence: observation.observationSequence
          };
          laneState.evidenceById.set(id, evidence);
        } else {
          const adjacentGap = observation.now - evidence.lastObservedAt;
          if (adjacentGap > this.configuration.maximumObservationGapMs) {
            evidence = {
              count: 1,
              firstObservedAt: observation.now,
              lastObservedAt: observation.now,
              lastObservationSequence: observation.observationSequence
            };
            laneState.evidenceById.set(id, evidence);
          } else if (adjacentGap >= this.configuration.minimumObservationGapMs) {
            evidence.count += 1;
            evidence.lastObservedAt = observation.now;
            evidence.lastObservationSequence = observation.observationSequence;
          }
        }

        const observedForMs = observation.now - evidence.firstObservedAt;
        if (evidence.count >= this.configuration.minimumObservations
            && observedForMs >= this.configuration.minimumObservationSpanMs) {
          suppressedIds.add(id);
          return;
        }

        const gapRemaining = Math.max(
          0,
          this.configuration.minimumObservationGapMs - (observation.now - evidence.lastObservedAt)
        );
        const spanRemaining = Math.max(0, this.configuration.minimumObservationSpanMs - observedForMs);
        const delay = evidence.count < this.configuration.minimumObservations
          ? gapRemaining
          : spanRemaining;
        nextObservationDelayMs = nextObservationDelayMs === null
          ? delay
          : Math.min(nextObservationDelayMs, delay);
      });
    });

    if (suppressedIds.size) {
      return makeDecision(
        "active",
        `confirmed absent after ${this.configuration.minimumObservations} settled observations`,
        suppressedIds,
        nextObservationDelayMs,
        scope,
        observation
      );
    }
    if (missingCandidateCount) {
      return makeDecision(
        "observing",
        laneReasons.length ? laneReasons.join("; ") : "confirming DOM absence",
        [],
        nextObservationDelayMs ?? this.configuration.minimumObservationGapMs,
        scope,
        observation
      );
    }
    return makeDecision(
      "inactive",
      laneReasons.length ? laneReasons.join("; ") : "all scoped structured records are present",
      [],
      null,
      scope,
      observation
    );
  }
}

export function createOutlookPresenceSuppressionPolicy(configuration) {
  return new OutlookPresenceSuppressionPolicy(configuration);
}

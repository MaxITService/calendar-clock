const MAX_NAVIGATION_ATTEMPTS = 7;

export function normalizeDateKeys(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || ""))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))))
    .sort();
}

function includesTarget(keys, targetDateKey) {
  return keys.includes(targetDateKey);
}

async function pollVisibleDateKeys(options, previousKeys) {
  if (typeof options.waitForVisibleDateKeys === "function") {
    return normalizeDateKeys(await options.waitForVisibleDateKeys(previousKeys, options.signal));
  }
  const timeoutMs = Math.max(250, Math.min(5000, Number(options.settleTimeoutMs) || 2500));
  const pollMs = Math.max(40, Math.min(500, Number(options.pollMs) || 100));
  const deadline = Date.now() + timeoutMs;
  while (!options.signal?.aborted && Date.now() < deadline) {
    const keys = normalizeDateKeys(options.readVisibleDateKeys?.());
    if (keys.length && keys.join(",") !== previousKeys.join(",")) return keys;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return normalizeDateKeys(options.readVisibleDateKeys?.());
}

async function activateControl(action, options, visibleDateKeys) {
  if (options.signal?.aborted) return { ok: false, reason: "navigation superseded" };
  const control = options.findControl?.(action);
  if (!control || typeof control.click !== "function") {
    return { ok: false, reason: `${action} navigation control is unavailable` };
  }
  try {
    control.click();
  } catch (error) {
    return { ok: false, reason: `${action} navigation failed: ${String(error?.message || error)}` };
  }
  const nextKeys = await pollVisibleDateKeys(options, visibleDateKeys);
  return { ok: true, visibleDateKeys: nextKeys };
}

export async function navigateWithPeriodControls(options = {}) {
  const targetDateKey = String(options.targetDateKey || "");
  const todayDateKey = String(options.todayDateKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateKey)
      || !/^\d{4}-\d{2}-\d{2}$/.test(todayDateKey)
      || typeof options.readVisibleDateKeys !== "function"
      || typeof options.findControl !== "function") {
    return { ok: false, reason: "calendar navigation capability is incomplete" };
  }

  let visibleDateKeys = normalizeDateKeys(options.readVisibleDateKeys());
  if (includesTarget(visibleDateKeys, targetDateKey)) {
    return { ok: true, visibleDateKeys, navigationCount: 0 };
  }
  if (!visibleDateKeys.length) {
    visibleDateKeys = await pollVisibleDateKeys(options, []);
    if (includesTarget(visibleDateKeys, targetDateKey)) {
      return { ok: true, visibleDateKeys, navigationCount: 0 };
    }
    if (!visibleDateKeys.length) {
      return { ok: false, reason: "the provider's visible date range is unavailable" };
    }
  }

  let navigationCount = 0;
  const targetNearToday = Math.abs(
    Date.parse(`${targetDateKey}T00:00:00Z`) - Date.parse(`${todayDateKey}T00:00:00Z`)
  ) <= 24 * 60 * 60 * 1000;
  if (targetNearToday && !includesTarget(visibleDateKeys, todayDateKey)) {
    const todayResult = await activateControl("today", options, visibleDateKeys);
    if (!todayResult.ok) return todayResult;
    navigationCount += 1;
    visibleDateKeys = todayResult.visibleDateKeys;
    if (includesTarget(visibleDateKeys, targetDateKey)) {
      return { ok: true, visibleDateKeys, navigationCount };
    }
  }

  const maxAttempts = Math.max(
    1,
    Math.min(MAX_NAVIGATION_ATTEMPTS, Number(options.maxAttempts) || 3)
  );
  for (let attempt = navigationCount; attempt < maxAttempts && !options.signal?.aborted; attempt += 1) {
    if (!visibleDateKeys.length) break;
    const action = targetDateKey < visibleDateKeys[0] ? "previous" : "next";
    const result = await activateControl(action, options, visibleDateKeys);
    if (!result.ok) return result;
    navigationCount += 1;
    visibleDateKeys = result.visibleDateKeys;
    if (includesTarget(visibleDateKeys, targetDateKey)) {
      return { ok: true, visibleDateKeys, navigationCount };
    }
  }

  return {
    ok: false,
    reason: options.signal?.aborted
      ? "navigation superseded"
      : `the provider did not reach ${targetDateKey} after bounded navigation`,
    visibleDateKeys,
    navigationCount
  };
}

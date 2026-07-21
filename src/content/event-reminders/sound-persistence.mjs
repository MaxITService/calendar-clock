import { generateSoundId, isValidSoundId } from "./helpers.mjs";

export const ORPHAN_QUARANTINE_MS = 5 * 60 * 1000;

function isUsableBlob(blob) {
  return typeof Blob !== "undefined" && blob instanceof Blob && blob.size > 0;
}

function reportWarning(warn, error) {
  try { warn?.(error); } catch (_warningError) { /* cleanup diagnostics stay best effort */ }
}

async function warnOnly(action, warn) {
  try { return await action(); }
  catch (error) {
    reportWarning(warn, error);
    return null;
  }
}

export async function cleanupOrphanSounds(
  storage,
  activeSoundId,
  warn = () => {},
  { now = Date.now, quarantineMs = ORPHAN_QUARANTINE_MS } = {}
) {
  const activeId = isValidSoundId(activeSoundId) ? activeSoundId.toLowerCase() : null;
  let descriptors;
  try {
    descriptors = await storage.list();
  } catch (error) {
    reportWarning(warn, error);
    return false;
  }
  let currentTime;
  try { currentTime = Number(typeof now === "function" ? now() : now); }
  catch (error) {
    reportWarning(warn, error);
    return false;
  }
  const quarantine = Number(quarantineMs);
  if (!Array.isArray(descriptors) || !Number.isFinite(currentTime) || currentTime < 0
    || !Number.isFinite(quarantine) || quarantine < 0) {
    reportWarning(warn, new Error("Audio storage returned invalid cleanup metadata."));
    return false;
  }
  const validated = new Map();
  descriptors.forEach(descriptor => {
    const soundId = isValidSoundId(descriptor?.soundId) ? descriptor.soundId.toLowerCase() : null;
    const createdAt = descriptor?.createdAt;
    if (!soundId || typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) {
      reportWarning(warn, new Error("Audio storage skipped an invalid sound descriptor."));
      return;
    }
    if (validated.has(soundId)) {
      validated.set(soundId, null);
      reportWarning(warn, new Error("Audio storage skipped duplicate sound descriptors."));
      return;
    }
    validated.set(soundId, { soundId, createdAt });
  });
  const cutoff = currentTime - quarantine;
  await Promise.all([...validated.values()]
    .filter(descriptor => descriptor && descriptor.soundId !== activeId && descriptor.createdAt <= cutoff)
    .map(descriptor => warnOnly(() => storage.delete(descriptor.soundId), warn)));
  return true;
}

export async function clearSelectedSoundAndCleanup(
  storage,
  selectedSoundId,
  warn = () => {},
  cleanupOptions = {}
) {
  const selectedId = isValidSoundId(selectedSoundId) ? selectedSoundId.toLowerCase() : null;
  if (selectedId) await warnOnly(() => storage.delete(selectedId), warn);
  return cleanupOrphanSounds(storage, null, warn, cleanupOptions);
}

export async function saveSoundSelection({
  storage,
  settings,
  previousSoundId,
  pendingBlob = null,
  saveMetadata,
  commitMemory,
  createSoundId = generateSoundId,
  cleanupOptions = {},
  warn = () => {}
}) {
  const oldId = isValidSoundId(previousSoundId) ? previousSoundId.toLowerCase() : null;
  const target = { ...settings };

  if (target.soundKind !== "custom") {
    target.soundKind = "builtin";
    target.soundId = null;
    await saveMetadata(target);
    commitMemory(target);
    if (oldId) await warnOnly(() => storage.delete(oldId), warn);
    await cleanupOrphanSounds(storage, null, warn, cleanupOptions);
    return target;
  }

  let sourceId = null;
  let blobToVersion = pendingBlob;
  if (pendingBlob) {
    if (!isUsableBlob(pendingBlob)) throw new Error("The selected custom sound is missing or invalid.");
  } else {
    if (!isValidSoundId(target.soundId)) throw new Error("The selected custom sound has invalid metadata. Upload it again.");
    sourceId = target.soundId.toLowerCase();
    blobToVersion = await storage.get(sourceId);
    if (!isUsableBlob(blobToVersion)) throw new Error("The selected custom sound is missing or invalid. Upload it again.");
  }
  let newId = createSoundId();
  if (!isValidSoundId(newId)) throw new Error("A valid custom sound ID could not be generated.");
  newId = newId.toLowerCase();
  if (newId === oldId || newId === sourceId) throw new Error("A fresh custom sound ID could not be generated.");
  await storage.put(newId, blobToVersion);
  target.soundId = newId;

  try {
    await saveMetadata(target);
  } catch (error) {
    if (newId) await warnOnly(() => storage.delete(newId), warn);
    throw error;
  }
  commitMemory(target);
  const retiredIds = new Set([oldId, sourceId].filter(soundId => soundId && soundId !== target.soundId));
  for (const retiredId of retiredIds) await warnOnly(() => storage.delete(retiredId), warn);
  await cleanupOrphanSounds(storage, target.soundId, warn, cleanupOptions);
  return target;
}

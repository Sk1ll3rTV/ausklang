import { dayClock, dayKeyOf } from '../domain/time';
import type { Settings } from '../domain/types';
import { db } from './db';
import { loadSettings } from './repo';

interface PersonalImportSettings {
  baselineCigarettesPerDay?: number;
  baselineFirstCigaretteDelayMin?: number;
  packPrice?: number;
  cigarettesPerPack?: number;
  usualWakeTime?: string;
  usualSleepTime?: string;
  cessationTargetMinDays?: number;
  cessationTargetMaxDays?: number;
}

export interface PersonalImportPayload {
  v: 1 | 2;
  planStartedAt?: number;
  cigarettes?: number[];
  settings?: PersonalImportSettings;
}

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const IMPORT_DEDUPE_WINDOW_MS = 2 * 60_000;

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function validPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validImportSettings(value: unknown): value is PersonalImportSettings {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const s = value as PersonalImportSettings;
  return (
    (s.baselineCigarettesPerDay === undefined || validPositive(s.baselineCigarettesPerDay)) &&
    (s.baselineFirstCigaretteDelayMin === undefined || validNonNegative(s.baselineFirstCigaretteDelayMin)) &&
    (s.packPrice === undefined || validNonNegative(s.packPrice)) &&
    (s.cigarettesPerPack === undefined || validPositive(s.cigarettesPerPack)) &&
    (s.usualWakeTime === undefined || TIME_RE.test(s.usualWakeTime)) &&
    (s.usualSleepTime === undefined || TIME_RE.test(s.usualSleepTime)) &&
    (s.cessationTargetMinDays === undefined || validPositive(s.cessationTargetMinDays)) &&
    (s.cessationTargetMaxDays === undefined || validPositive(s.cessationTargetMaxDays))
  );
}

export function parsePersonalImportHash(hash: string): PersonalImportPayload | null {
  const prefix = '#import=';
  if (!hash.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(hash.slice(prefix.length))) as PersonalImportPayload;
    if (parsed.v !== 1 && parsed.v !== 2) return null;
    if (parsed.planStartedAt !== undefined && !validPositive(parsed.planStartedAt)) return null;
    if (parsed.cigarettes && !parsed.cigarettes.every(validPositive)) return null;
    if (!validImportSettings(parsed.settings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Reine Funktion, damit der Recovery-Pfad in Unit-Tests vollständig geprüft werden kann. */
export function settingsAfterPersonalImport(current: Settings, payload: PersonalImportPayload): Settings {
  const imported = payload.v >= 2 ? payload.settings ?? {} : {};
  const next: Settings = {
    ...current,
    ...imported,
    // v2 ist ein vollständiger Recovery-Import und darf das Onboarding überspringen.
    onboarded: payload.v >= 2 ? true : current.onboarded,
  };

  const planStartedAt =
    payload.planStartedAt === undefined
      ? next.planStartedAt
      : payload.v >= 2
        ? payload.planStartedAt
        : Math.min(next.planStartedAt, payload.planStartedAt);

  return {
    ...next,
    id: 'main',
    planStartedAt,
    currentPlanStartDate: dayKeyOf(planStartedAt, dayClock(next.usualWakeTime, next.usualSleepTime)),
  };
}

export function normalizedImportedCigaretteTimes(payload: PersonalImportPayload): number[] {
  return [...new Set(payload.cigarettes ?? [])].sort((a, b) => a - b);
}

/**
 * Importiert persönliche historische Daten ausschließlich aus dem URL-Fragment.
 * Fragmente werden nicht an GitHub Pages übertragen. Nach erfolgreichem Import wird
 * der Fragmentteil sofort aus der Adresszeile entfernt. Der Import ist idempotent.
 */
export async function importPersonalDataFromHash(): Promise<void> {
  if (typeof window === 'undefined') return;
  const payload = parsePersonalImportHash(window.location.hash);
  if (!payload) return;

  const current = await loadSettings();
  const nextSettings = settingsAfterPersonalImport(current, payload);
  const cigaretteTimes = normalizedImportedCigaretteTimes(payload);
  const clock = dayClock(nextSettings.usualWakeTime, nextSettings.usualSleepTime);
  const observedDays = new Set<string>();
  if (payload.planStartedAt !== undefined) observedDays.add(dayKeyOf(payload.planStartedAt, clock));
  for (const timestamp of cigaretteTimes) observedDays.add(dayKeyOf(timestamp, clock));

  await db.transaction('rw', db.settings, db.cigarettes, db.dayMarks, async () => {
    await db.settings.put(nextSettings);

    for (const timestamp of cigaretteTimes) {
      // Falls dieselbe Zigarette bereits manuell mit ein paar Sekunden Abweichung eingetragen wurde,
      // keinen Doppel-Eintrag erzeugen.
      const existsNearby = await db.cigarettes
        .where('timestamp')
        .between(timestamp - IMPORT_DEDUPE_WINDOW_MS, timestamp + IMPORT_DEDUPE_WINDOW_MS, true, true)
        .count();
      if (existsNearby > 0) continue;
      await db.cigarettes.add({
        id: `import-${timestamp}`,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    for (const date of observedDays) {
      const existing = await db.dayMarks.get(date);
      if (!existing) await db.dayMarks.put({ date, source: 'opened' });
    }
  });

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

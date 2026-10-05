import { defaultSettings } from '../domain/defaults';
import { dayClock, dayKeyOf } from '../domain/time';
import type {
  CigaretteEvent,
  CravingEvent,
  CravingOutcome,
  DailyPlan,
  DailySummary,
  DayKey,
  DayMark,
  EventContext,
  Settings,
} from '../domain/types';
import { db } from './db';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Entfernt leere Kontextfelder, damit optionale Angaben wirklich optional bleiben. */
export function cleanContext<T extends EventContext>(ctx: T): T {
  const out = { ...ctx };
  for (const key of ['trigger', 'mood', 'location', 'activity', 'companions', 'note'] as const) {
    const v = out[key]?.trim();
    if (v) out[key] = v;
    else delete out[key];
  }
  return out;
}

// --- Einstellungen -----------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  const existing = await db.settings.get('main');
  if (existing) return { ...defaultSettings(existing.planStartedAt), ...existing };
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await db.settings.put({ ...current, ...patch, id: 'main' });
}

/** Schließt das Onboarding ab und setzt den Planstart auf jetzt. */
export async function startPlan(patch: Partial<Settings>): Promise<void> {
  const now = Date.now();
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await db.settings.put({
    ...next,
    id: 'main',
    onboarded: true,
    planStartedAt: now,
    currentPlanStartDate: dayKeyOf(now, dayClock(next.usualWakeTime, next.usualSleepTime)),
  });
}

export async function rememberCustomOption(field: keyof Settings['customOptions'], value: string): Promise<void> {
  const v = value.trim();
  if (!v) return;
  const settings = await loadSettings();
  const list = settings.customOptions[field] ?? [];
  if (list.includes(v)) return;
  await saveSettings({ customOptions: { ...settings.customOptions, [field]: [...list, v].slice(-12) } });
}

// --- Zigaretten ---------------------------------------------------------------

export async function addCigarette(timestamp = Date.now(), ctx: EventContext = {}): Promise<CigaretteEvent> {
  const now = Date.now();
  const event: CigaretteEvent = { ...cleanContext(ctx), id: newId(), timestamp, createdAt: now, updatedAt: now };
  await db.cigarettes.add(event);
  return event;
}

export async function updateCigarette(id: string, patch: Partial<CigaretteEvent>): Promise<void> {
  const current = await db.cigarettes.get(id);
  if (!current) return;
  await db.cigarettes.put(cleanContext({ ...current, ...patch, id, updatedAt: Date.now() }));
}

export async function deleteCigarette(id: string): Promise<CigaretteEvent | undefined> {
  const current = await db.cigarettes.get(id);
  await db.cigarettes.delete(id);
  return current;
}

export async function restoreCigarette(event: CigaretteEvent): Promise<void> {
  await db.cigarettes.put(event);
}

// --- Verlangen ----------------------------------------------------------------

export async function addCraving(
  intensity: number,
  ctx: EventContext = {},
  startTimestamp = Date.now(),
): Promise<CravingEvent> {
  const now = Date.now();
  const event: CravingEvent = {
    ...cleanContext(ctx),
    id: newId(),
    startTimestamp,
    intensityInitial: intensity,
    outcome: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await db.cravings.add(event);
  return event;
}

export async function updateCraving(id: string, patch: Partial<CravingEvent>): Promise<void> {
  const current = await db.cravings.get(id);
  if (!current) return;
  const next = cleanContext({ ...current, ...patch, id, updatedAt: Date.now() });
  if (next.outcome === 'active') {
    delete next.endTimestamp;
    delete next.intensityFinal;
  }
  for (const key of ['copingStrategy', 'relatedCigaretteEventId', 'intensityFinal', 'endTimestamp'] as const) {
    if (next[key] === undefined || next[key] === '') delete next[key];
  }
  await db.cravings.put(next);
}

export async function resolveCraving(
  id: string,
  outcome: Exclude<CravingOutcome, 'active'>,
  extra: Partial<Pick<CravingEvent, 'endTimestamp' | 'intensityFinal' | 'copingStrategy' | 'relatedCigaretteEventId'>> = {},
): Promise<void> {
  await updateCraving(id, { outcome, endTimestamp: Date.now(), ...extra });
}

export async function deleteCraving(id: string): Promise<CravingEvent | undefined> {
  const current = await db.cravings.get(id);
  await db.cravings.delete(id);
  return current;
}

export async function restoreCraving(event: CravingEvent): Promise<void> {
  await db.cravings.put(event);
}

// --- Tage ---------------------------------------------------------------------

export async function markDay(date: DayKey, source: DayMark['source']): Promise<void> {
  const existing = await db.dayMarks.get(date);
  if (existing && (existing.source === source || existing.source === 'confirmed')) return;
  await db.dayMarks.put({ date, source });
}

/** Schreibt die abgeleiteten Schnappschüsse der Engine (für Export und Übergabe). */
export async function saveDerived(plans: DailyPlan[], summaries: DailySummary[]): Promise<void> {
  await db.transaction('rw', db.dailyPlans, db.dailySummaries, async () => {
    await db.dailyPlans.clear();
    await db.dailySummaries.clear();
    await db.dailyPlans.bulkPut(plans);
    await db.dailySummaries.bulkPut(summaries);
  });
}

export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

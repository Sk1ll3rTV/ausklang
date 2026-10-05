import { defaultSettings } from '../domain/defaults';
import {
  SCHEMA_VERSION,
  type CigaretteEvent,
  type CravingEvent,
  type DailyPlan,
  type DailySummary,
  type DayMark,
  type Settings,
} from '../domain/types';
import { db } from './db';

export interface Backup {
  app: 'ausklang';
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  cigarettes: CigaretteEvent[];
  cravings: CravingEvent[];
  dayMarks: DayMark[];
  /** Abgeleitet – wird beim Import nicht übernommen, sondern neu berechnet. */
  dailyPlans?: DailyPlan[];
  dailySummaries?: DailySummary[];
}

/** `derived`: frisch berechnete Tageswerte der Engine; ohne Angabe der zuletzt gespeicherte Stand. */
export async function createBackup(derived?: {
  dailyPlans: DailyPlan[];
  dailySummaries: DailySummary[];
}): Promise<Backup> {
  const [settings, cigarettes, cravings, dayMarks, storedPlans, storedSummaries] = await Promise.all([
    db.settings.get('main'),
    db.cigarettes.orderBy('timestamp').toArray(),
    db.cravings.orderBy('startTimestamp').toArray(),
    db.dayMarks.toArray(),
    db.dailyPlans.toArray(),
    db.dailySummaries.toArray(),
  ]);
  const s = settings ?? defaultSettings();
  return {
    app: 'ausklang',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    // Der Zugangscode für den KI-Proxy verlässt das Gerät nicht über ein Backup.
    settings: { ...s, coach: { ...s.coach, accessToken: '' } },
    cigarettes,
    cravings,
    dayMarks,
    dailyPlans: derived?.dailyPlans ?? storedPlans,
    dailySummaries: derived?.dailySummaries ?? storedSummaries,
  };
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Alle Einträge als eine CSV-Tabelle (Semikolon-getrennt, für Excel/Numbers). */
export function backupToCSV(backup: Backup): string {
  const header = [
    'typ',
    'zeitpunkt',
    'ende',
    'staerke_start',
    'staerke_ende',
    'ergebnis',
    'strategie',
    'ausloeser',
    'gefuehl',
    'ort',
    'taetigkeit',
    'mit_wem',
    'notiz',
  ];
  const iso = (ts?: number) => (ts ? new Date(ts).toISOString() : '');
  const rows: unknown[][] = [
    ...backup.cigarettes.map((c) => [
      'zigarette',
      iso(c.timestamp),
      '',
      '',
      '',
      '',
      '',
      c.trigger,
      c.mood,
      c.location,
      c.activity,
      c.companions,
      c.note,
    ]),
    ...backup.cravings.map((c) => [
      'verlangen',
      iso(c.startTimestamp),
      iso(c.endTimestamp),
      c.intensityInitial,
      c.intensityFinal,
      c.outcome,
      c.copingStrategy,
      c.trigger,
      c.mood,
      c.location,
      c.activity,
      c.companions,
      c.note,
    ]),
  ].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

export type ValidationResult =
  | { ok: true; backup: Backup; counts: { cigarettes: number; cravings: number; days: number } }
  | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);
const isHM = (v: unknown) => isStr(v) && /^\d{2}:\d{2}$/.test(v);
const isDay = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function contextOk(e: Record<string, unknown>): boolean {
  return ['trigger', 'mood', 'location', 'activity', 'companions', 'note'].every((k) => optStr(e[k]));
}

/** Prüft eine importierte Datei vollständig, bevor irgendetwas überschrieben wird. */
export function validateBackup(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(data) || data.app !== 'ausklang') {
    return { ok: false, errors: ['Die Datei ist kein Backup dieser App.'] };
  }
  if (!isNum(data.schemaVersion) || data.schemaVersion < 1) errors.push('Die Schema-Version fehlt.');
  else if (data.schemaVersion > SCHEMA_VERSION)
    errors.push('Das Backup stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');

  const s = data.settings;
  if (!isObj(s)) errors.push('Die Einstellungen fehlen.');
  else {
    if (!isNum(s.baselineCigarettesPerDay) || s.baselineCigarettesPerDay <= 0 || s.baselineCigarettesPerDay > 200)
      errors.push('Der Ausgangskonsum ist ungültig.');
    if (!isNum(s.packPrice) || s.packPrice < 0) errors.push('Der Packungspreis ist ungültig.');
    if (!isNum(s.cigarettesPerPack) || s.cigarettesPerPack <= 0) errors.push('Die Packungsgröße ist ungültig.');
    if (!isHM(s.usualWakeTime) || !isHM(s.usualSleepTime)) errors.push('Die Schlafzeiten sind ungültig.');
    if (!isDay(s.currentPlanStartDate) || !isNum(s.planStartedAt)) errors.push('Der Planstart ist ungültig.');
  }

  const cigs = data.cigarettes;
  if (!Array.isArray(cigs)) errors.push('Die Zigaretten-Einträge fehlen.');
  else if (!cigs.every((c) => isObj(c) && isStr(c.id) && isNum(c.timestamp) && contextOk(c)))
    errors.push('Mindestens ein Zigaretten-Eintrag ist fehlerhaft.');

  const cravings = data.cravings;
  if (!Array.isArray(cravings)) errors.push('Die Verlangen-Einträge fehlen.');
  else if (
    !cravings.every(
      (c) =>
        isObj(c) &&
        isStr(c.id) &&
        isNum(c.startTimestamp) &&
        isNum(c.intensityInitial) &&
        c.intensityInitial >= 1 &&
        c.intensityInitial <= 10 &&
        (c.endTimestamp === undefined || isNum(c.endTimestamp)) &&
        (c.outcome === 'active' || c.outcome === 'passed' || c.outcome === 'smoked') &&
        contextOk(c),
    )
  )
    errors.push('Mindestens ein Verlangen-Eintrag ist fehlerhaft.');

  const marks = data.dayMarks ?? [];
  if (!Array.isArray(marks) || !marks.every((m) => isObj(m) && isDay(m.date)))
    errors.push('Die Tagesmarkierungen sind fehlerhaft.');

  if (errors.length) return { ok: false, errors };

  const backup = data as unknown as Backup;
  const ids = new Set<string>();
  for (const e of [...backup.cigarettes, ...backup.cravings]) {
    if (ids.has(e.id)) return { ok: false, errors: ['Das Backup enthält doppelte Einträge.'] };
    ids.add(e.id);
  }
  const days = new Set(backup.cigarettes.map((c) => new Date(c.timestamp).toDateString()));
  return {
    ok: true,
    backup: { ...backup, dayMarks: (marks as DayMark[]).map((m) => ({ date: m.date, source: m.source ?? 'opened' })) },
    counts: { cigarettes: backup.cigarettes.length, cravings: backup.cravings.length, days: days.size },
  };
}

/** Ersetzt alle lokalen Daten durch das Backup. Der lokale KI-Zugangscode bleibt erhalten. */
export async function importBackup(backup: Backup): Promise<void> {
  const current = await db.settings.get('main');
  const base = defaultSettings(backup.settings.planStartedAt);
  const settings: Settings = {
    ...base,
    ...backup.settings,
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    onboarded: true,
    coach: {
      ...base.coach,
      ...backup.settings.coach,
      accessToken: current?.coach?.accessToken ?? '',
    },
    customOptions: { ...base.customOptions, ...backup.settings.customOptions },
  };
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.settings.put(settings);
    await db.cigarettes.bulkPut(backup.cigarettes);
    await db.cravings.bulkPut(backup.cravings);
    await db.dayMarks.bulkPut(backup.dayMarks);
  });
}

/** Übergibt eine Datei an das System: Teilen-Dialog (iOS-PWA) oder klassischer Download. */
export async function deliverFile(filename: string, content: string, mime: string): Promise<void> {
  const blob = new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    // Teilen-Dialog nur auf Touch-Geräten; am Desktop ist ein Download erwartbarer.
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    // Teilen nicht möglich → Download versuchen.
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

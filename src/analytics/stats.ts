import { STRONG_CRAVING } from '../domain/defaults';
import { MIN } from '../domain/time';
import type { CigaretteEvent, CravingEvent } from '../domain/types';
import type { AppModel, DayRecord } from '../engine/model';

/**
 * Deterministische Kennzahlen aus dem abgeleiteten Modell. Jede Funktion liefert `null` bzw. eine
 * leere Liste, wenn die Datenlage für eine belastbare Aussage noch nicht reicht.
 */

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Abgeschlossene Tage, die in die Planung eingehen. */
export const usableDays = (model: AppModel): DayRecord[] => model.days.filter((d) => d.usable);

/** Tage der letzten `n` Kalendertage inkl. heute, sofern beobachtet. */
export function windowDays(model: AppModel, n: number): DayRecord[] {
  return model.days.slice(-n).filter((d) => d.observed);
}

export const allCigarettes = (days: DayRecord[]): CigaretteEvent[] => days.flatMap((d) => d.cigarettes);
export const allCravings = (days: DayRecord[]): CravingEvent[] => days.flatMap((d) => d.cravings);

/** Tagesmenge, bei angebrochenem Starttag hochgerechnet. */
export const effectiveCount = (d: DayRecord) => d.cigarettes.length / (d.usable ? d.coverage : 1);

export interface Reduction {
  days: number;
  average: number;
  /** 0–1, Anteil unter dem Ausgangsniveau. */
  ratio: number;
}

export function recentReduction(model: AppModel, baseline: number, n = 7): Reduction | null {
  const days = usableDays(model).slice(-n);
  if (days.length < 2 || baseline <= 0) return null;
  const average = mean(days.map(effectiveCount));
  return { days: days.length, average, ratio: 1 - average / baseline };
}

export interface FirstCigShift {
  days: number;
  averageDelayMin: number;
  shiftMin: number;
}

export function firstCigaretteShift(model: AppModel, baselineDelayMin: number, n = 7): FirstCigShift | null {
  const delays = model.days
    .filter((d) => d.complete && d.observed && d.cigarettes.length > 0)
    .slice(-n)
    .map((d) => (d.cigarettes[0].timestamp - d.wakeTs) / MIN);
  if (delays.length < 2) return null;
  const averageDelayMin = mean(delays);
  return { days: delays.length, averageDelayMin, shiftMin: averageDelayMin - baselineDelayMin };
}

export interface Ranked {
  name: string;
  count: number;
}

function rank(values: (string | undefined)[]): Ranked[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** Auslöser über Zigaretten und Verlangen der letzten `n` Tage. */
export function triggerRanking(model: AppModel, n = 14): Ranked[] {
  const days = windowDays(model, n);
  return rank([...allCigarettes(days).map((c) => c.trigger), ...allCravings(days).map((c) => c.trigger)]);
}

export function hourHistogram(model: AppModel, n = 14): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const c of allCigarettes(windowDays(model, n))) hours[new Date(c.timestamp).getHours()]++;
  return hours;
}

export interface HotWindow {
  fromHour: number;
  toHour: number;
  count: number;
  /** Faktor gegenüber gleichmäßiger Verteilung über die Wachzeit. */
  factor: number;
}

/** Drei-Stunden-Fenster mit überdurchschnittlich vielen Zigaretten. */
export function hotWindow(model: AppModel, n = 14): HotWindow | null {
  const hours = hourHistogram(model, n);
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < 12) return null;
  let best = { from: 0, count: -1 };
  for (let h = 0; h < 24; h++) {
    const count = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    if (count > best.count) best = { from: h, count };
  }
  const expected = (total * 3) / (model.clock.wakeDurationMin / 60);
  const factor = best.count / expected;
  if (best.count < 5 || factor < 1.35) return null;
  return { fromHour: best.from, toHour: (best.from + 3) % 24, count: best.count, factor };
}

export interface CravingRates {
  mild: { total: number; passed: number };
  strong: { total: number; passed: number };
}

export function cravingRates(model: AppModel, n = 30): CravingRates {
  const resolved = allCravings(windowDays(model, n)).filter((c) => c.outcome !== 'active');
  const group = (list: CravingEvent[]) => ({
    total: list.length,
    passed: list.filter((c) => c.outcome === 'passed').length,
  });
  return {
    mild: group(resolved.filter((c) => c.intensityInitial < STRONG_CRAVING)),
    strong: group(resolved.filter((c) => c.intensityInitial >= STRONG_CRAVING)),
  };
}

export interface FollowUp {
  trigger: string;
  total: number;
  followed: number;
}

/** Wie oft folgt auf ein Verlangen mit bestimmtem Auslöser innerhalb von 20 Minuten eine Zigarette? */
export function triggerFollowUps(model: AppModel, n = 30, minCount = 4): FollowUp[] {
  const days = windowDays(model, n);
  const times = allCigarettes(days)
    .map((c) => c.timestamp)
    .sort((a, b) => a - b);
  const byTrigger = new Map<string, FollowUp>();
  for (const c of allCravings(days)) {
    if (!c.trigger || c.outcome === 'active') continue;
    const entry = byTrigger.get(c.trigger) ?? { trigger: c.trigger, total: 0, followed: 0 };
    entry.total++;
    if (times.some((t) => t >= c.startTimestamp && t <= c.startTimestamp + 20 * MIN)) entry.followed++;
    byTrigger.set(c.trigger, entry);
  }
  return [...byTrigger.values()].filter((f) => f.total >= minCount).sort((a, b) => b.total - a.total);
}

/** Anteil der Zigaretten mit Angabe „mit wem“, die nicht allein geraucht wurden. */
export function companyShare(model: AppModel, n = 30): { total: number; withOthers: number } | null {
  const tagged = allCigarettes(windowDays(model, n)).filter((c) => c.companions);
  if (tagged.length < 6) return null;
  return { total: tagged.length, withOthers: tagged.filter((c) => c.companions !== 'allein').length };
}

export interface EasySlot {
  hour: number;
  present: number;
  total: number;
  trigger?: string;
}

const EASY_TRIGGERS = new Set(['Gewohnheit', 'Langeweile', 'nach dem Essen']);

/**
 * Stunde, in der zuletzt nur noch an manchen Tagen geraucht wurde – ein Zeitfenster, das bereits
 * teilweise wegfällt und deshalb am leichtesten ganz verschwinden dürfte.
 */
export function easiestSlot(model: AppModel, n = 7): EasySlot | null {
  const days = usableDays(model).slice(-n);
  if (days.length < 4) return null;
  let best: (EasySlot & { score: number }) | null = null;
  for (let hour = 0; hour < 24; hour++) {
    const inHour = days.map((d) => d.cigarettes.filter((c) => new Date(c.timestamp).getHours() === hour));
    const present = inHour.filter((l) => l.length > 0).length;
    const share = present / days.length;
    if (present < 1 || share > 0.5) continue;
    const trigger = rank(inHour.flat().map((c) => c.trigger))[0]?.name;
    const score = 1 - share + (trigger && EASY_TRIGGERS.has(trigger) ? 0.3 : 0) + (present >= 2 ? 0.2 : 0);
    if (!best || score > best.score) best = { hour, present, total: days.length, trigger, score };
  }
  return best && { hour: best.hour, present: best.present, total: best.total, trigger: best.trigger };
}

/** Liegt der Verbrauch der letzten Tage unter den internen Zielen? */
export function leadOverPlan(model: AppModel, n = 4): { days: number; lead: number } | null {
  const days = usableDays(model).slice(-n);
  if (days.length < n) return null;
  const diffs = days.map((d) => d.plan.internalTarget - effectiveCount(d));
  if (diffs.some((x) => x < 0)) return null;
  const lead = diffs.reduce((a, b) => a + b, 0);
  return lead >= 3 ? { days: days.length, lead } : null;
}

export interface CopingStat {
  strategy: string;
  tried: number;
  worked: number;
  /** Gesetzt, wenn die Aussage auf einen Ort eingegrenzt ist. */
  location?: string;
}

/** Erfolg je Strategie, optional nur für starke Verlangen. */
export function copingStats(model: AppModel, opts: { strongOnly?: boolean; byLocation?: boolean } = {}): CopingStat[] {
  const stats = new Map<string, CopingStat>();
  for (const c of allCravings(model.days)) {
    if (!c.copingStrategy || c.outcome === 'active') continue;
    if (opts.strongOnly && c.intensityInitial < STRONG_CRAVING) continue;
    if (opts.byLocation && !c.location) continue;
    const key = opts.byLocation ? `${c.copingStrategy}|${c.location}` : c.copingStrategy;
    const entry = stats.get(key) ?? {
      strategy: c.copingStrategy,
      tried: 0,
      worked: 0,
      ...(opts.byLocation ? { location: c.location } : {}),
    };
    entry.tried++;
    if (c.outcome === 'passed') entry.worked++;
    stats.set(key, entry);
  }
  return [...stats.values()].sort((a, b) => b.worked / b.tried - a.worked / a.tried || b.tried - a.tried);
}

/** Bewährteste Strategie des Nutzers (mind. zwei Erfolge) – für den Hilfe-Modus. */
export function bestCopingStrategy(model: AppModel): CopingStat | null {
  return copingStats(model).find((s) => s.worked >= 2) ?? null;
}

export interface TodayComparison {
  count: number;
  /** Durchschnittliche Menge bis zur selben Uhrzeit an den letzten Tagen. */
  usualByNow: number;
  days: number;
  /** Drei-Stunden-Block mit der größten Abweichung nach oben. */
  block: { fromHour: number; toHour: number; today: number; usual: number } | null;
  triggers: Ranked[];
}

export function compareTodayWithUsual(model: AppModel, n = 7): TodayComparison | null {
  const past = usableDays(model).slice(-n);
  if (past.length < 2) return null;
  const today = model.today;
  const elapsed = model.now - today.startTs;
  const usualByNow = mean(past.map((d) => d.cigarettes.filter((c) => c.timestamp - d.startTs <= elapsed).length));

  let block: TodayComparison['block'] = null;
  for (let from = 0; from < 24; from += 3) {
    const inBlock = (c: CigaretteEvent) => {
      const h = new Date(c.timestamp).getHours();
      return h >= from && h < from + 3;
    };
    const todayCount = today.cigarettes.filter(inBlock).length;
    const usual = mean(past.map((d) => d.cigarettes.filter(inBlock).length));
    if (todayCount - usual >= 1.5 && (!block || todayCount - usual > block.today - block.usual)) {
      block = { fromHour: from, toHour: from + 3, today: todayCount, usual };
    }
  }
  return {
    count: today.cigarettes.length,
    usualByNow,
    days: past.length,
    block,
    triggers: rank(today.cigarettes.map((c) => c.trigger)),
  };
}

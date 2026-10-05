import type { DayKey } from './types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** "07:30" → 450 */
export function parseHM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (((h || 0) * 60 + (m || 0)) % 1440 + 1440) % 1440;
}

/** Minuten seit Mitternacht → "HH:MM" (läuft über 24 h um). */
export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface DayClock {
  wakeMin: number;
  sleepMin: number;
  wakeDurationMin: number;
  /**
   * Beginn des logischen Tages relativ zu Mitternacht des Aufwach-Datums (Schlafmitte).
   * Kann negativ sein, wenn die Schlafmitte vor Mitternacht liegt.
   */
  offsetMin: number;
}

export function dayClock(wake: string, sleep: string): DayClock {
  const wakeMin = parseHM(wake);
  const sleepMin = parseHM(sleep);
  let wakeDurationMin = (sleepMin - wakeMin + 1440) % 1440;
  // Unplausible Eingaben (z. B. identische Zeiten) fallen auf 17 h Wachzeit zurück.
  if (wakeDurationMin < 240 || wakeDurationMin > 1380) wakeDurationMin = 1020;
  const sleepDurationMin = 1440 - wakeDurationMin;
  return { wakeMin, sleepMin, wakeDurationMin, offsetMin: wakeMin - sleepDurationMin / 2 };
}

export function toDayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m - 1, d];
}

export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = parts(key);
  return new Date(y, m, d);
}

/** Logischer Tag eines Zeitpunkts. Der Tag wechselt in der Schlafmitte, nicht um Mitternacht. */
export function dayKeyOf(ts: number, clock: DayClock): DayKey {
  return toDayKey(new Date(ts - clock.offsetMin * MIN));
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = parts(key);
  return toDayKey(new Date(y, m, d + n));
}

export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / DAY);
}

export function dayStart(key: DayKey, clock: DayClock): number {
  const [y, m, d] = parts(key);
  return new Date(y, m, d, 0, clock.offsetMin).getTime();
}

export function dayEnd(key: DayKey, clock: DayClock): number {
  return dayStart(addDays(key, 1), clock);
}

export function wakeTime(key: DayKey, clock: DayClock): number {
  const [y, m, d] = parts(key);
  return new Date(y, m, d, 0, clock.wakeMin).getTime();
}

export function sleepTime(key: DayKey, clock: DayClock): number {
  return wakeTime(key, clock) + clock.wakeDurationMin * MIN;
}

export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

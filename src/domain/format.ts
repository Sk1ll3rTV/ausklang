import { parseDayKey } from './time';
import type { DayKey, DayStatus } from './types';

const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export const euro = (n: number) => euroFmt.format(n);

export const num = (n: number, digits = 0) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (ratio: number) => `${Math.round(ratio * 100)} %`;

export const cigarettes = (n: number) => (n === 1 ? '1 Zigarette' : `${num(n)} Zigaretten`);

export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

/** 46 → „46 Min“, 70 → „1 Std 10 Min“ */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} Std ${rest} Min` : `${h} Std`;
}

export function dayLabel(key: DayKey, style: 'long' | 'short' | 'weekday' = 'long'): string {
  const d = parseDayKey(key);
  if (style === 'weekday') return d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  if (style === 'short') return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  green: 'Im Plan',
  orange: 'Etwas über deinem Bereich',
  red: 'Heute deutlich über deinem Bereich',
};

export const STATUS_LABEL_PAST: Record<DayStatus, string> = {
  green: 'Im Plan',
  orange: 'Etwas über dem Bereich',
  red: 'Deutlich über dem Bereich',
};

export const hourRange = (from: number, to: number) => `${from} und ${to} Uhr`;

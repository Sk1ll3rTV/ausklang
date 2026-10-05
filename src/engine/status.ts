import type { DayStatus } from '../domain/types';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Persönliches Tageszeitprofil: Welcher Anteil des Tageskonsums ist bis zum Wachzeit-Anteil f
 * üblicherweise erreicht? Startet gleichverteilt und nähert sich mit wachsender Datenmenge der
 * tatsächlichen Verteilung an.
 */
export function buildCumulativeShare(samples: number[]): (wakeFraction: number) => number {
  const sorted = samples.map(clamp01).sort((a, b) => a - b);
  const n = sorted.length;
  const weight = n / (n + 30);
  return (f: number) => {
    if (f <= 0) return 0;
    if (f >= 1) return 1;
    let below = 0;
    while (below < n && sorted[below] <= f) below++;
    const empirical = n ? below / n : f;
    return clamp01((1 - weight) * f + weight * empirical);
  };
}

export interface ProjectionInput {
  count: number;
  /** Üblicher Anteil des Tageskonsums bis jetzt (0–1). */
  share: number;
  /** Erwartung vor dem ersten Datenpunkt des Tages. */
  prior: number;
}

/**
 * Prognose der Tagesmenge. Früh am Tag dominiert die Erwartung (prior), später das tatsächliche
 * Tempo – so kippt die Prognose nicht wegen einer einzelnen frühen Zigarette.
 */
export function calculateProjectedConsumption({ count, share, prior }: ProjectionInput): number {
  const s = clamp01(share);
  if (s >= 1) return count;
  const pace = s > 0.05 ? count / s : prior;
  const reference = s * pace + (1 - s) * prior;
  return count + (1 - s) * reference;
}

export interface StatusLimits {
  green: number;
  red: number;
}

/**
 * Grün: bis ca. 10 % über dem Ziel (mindestens +1). Rot: mehr als ca. 30 % UND eine absolute
 * Abweichung von mindestens 2–3 Zigaretten. Dazwischen Orange.
 */
export function statusLimits(target: number): StatusLimits {
  return {
    green: Math.max(target * 1.1, target + (target >= 3 ? 1 : 0.5)),
    red: Math.max(target * 1.3, target + (target >= 5 ? 3 : 2)),
  };
}

/** Status ohne Hysterese – für abgeschlossene Tage. */
export function finalDayStatus(count: number, target: number): DayStatus {
  const { green, red } = statusLimits(target);
  if (count > red) return 'red';
  if (count > green) return 'orange';
  return 'green';
}

/**
 * Status mit Hysterese: Ein Wechsel braucht etwas mehr als das bloße Überschreiten der Grenze,
 * damit die Farbe nicht bei jedem Eintrag springt.
 */
export function classifyStatus(
  projected: number,
  target: number,
  previous: DayStatus | null,
  redAllowed = true,
): DayStatus {
  const { green, red } = statusLimits(target);
  const h = Math.max(0.5, target * 0.04);
  const prev = previous ?? 'green';
  if (prev === 'red') {
    if (projected > red - h) return 'red';
    return projected > green - h ? 'orange' : 'green';
  }
  if (redAllowed && projected > red + h) return 'red';
  if (prev === 'orange') return projected <= green - h ? 'green' : 'orange';
  return projected > green + h ? 'orange' : 'green';
}

export interface DailyStatusInput {
  target: number;
  /** Zeitstempel der Zigaretten des Tages. */
  cigaretteTimes: number[];
  now: number;
  wakeTs: number;
  sleepTs: number;
  shareAt: (wakeFraction: number) => number;
  prior: number;
}

/** Anteil der Wachzeit, ab dem Rot überhaupt möglich ist. */
export const RED_MIN_DAY_SHARE = 0.35;

/**
 * Laufender Tagesstatus. Der Tag wird Eintrag für Eintrag nachgespielt, damit die Hysterese
 * deterministisch aus den Rohdaten folgt (kein gespeicherter Zwischenzustand nötig).
 */
export function calculateDailyStatus(input: DailyStatusInput): { status: DayStatus; projected: number } {
  const { target, now, wakeTs, sleepTs, shareAt, prior } = input;
  const times = input.cigaretteTimes.filter((t) => t <= now).sort((a, b) => a - b);
  const limits = statusLimits(target);
  let status: DayStatus = 'green';
  let projected = prior;
  const checkpoints = [...times, now];
  checkpoints.forEach((cp, i) => {
    const count = Math.min(i + 1, times.length);
    const fraction = clamp01((cp - wakeTs) / (sleepTs - wakeTs));
    projected = calculateProjectedConsumption({ count, share: shareAt(fraction), prior });
    const redAllowed = fraction >= RED_MIN_DAY_SHARE || count > limits.red;
    status = classifyStatus(projected, target, status, redAllowed);
  });
  return { status, projected };
}

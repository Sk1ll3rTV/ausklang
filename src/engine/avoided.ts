/**
 * „Vermiedene Zigaretten“: Differenz zwischen der ursprünglichen Baseline und dem tatsächlichen
 * Konsum. Die Baseline baut sich ausschließlich während der Wachzeit auf – nachts wächst nichts.
 */

export interface AvoidedDayInput {
  wakeTs: number;
  sleepTs: number;
  /** Tatsächlich eingetragene Zigaretten des logischen Tages (inkl. nächtlicher). */
  count: number;
  /** Unbeobachtete Tage zählen weder positiv noch negativ. */
  observed: boolean;
}

/** Erwartete Baseline-Zigaretten im Intervall [from, until], begrenzt auf das Wachfenster. */
export function expectedBaseline(
  baselinePerDay: number,
  wakeTs: number,
  sleepTs: number,
  from: number,
  until: number,
): number {
  const start = Math.max(wakeTs, from);
  const end = Math.min(sleepTs, until);
  if (end <= start || sleepTs <= wakeTs) return 0;
  return (baselinePerDay * (end - start)) / (sleepTs - wakeTs);
}

/** Rohwert eines Tages – darf negativ sein (mehr geraucht als die Baseline bis dahin). */
export function avoidedForDay(baselinePerDay: number, day: AvoidedDayInput, trackFrom: number, now: number): number {
  if (!day.observed) return 0;
  return expectedBaseline(baselinePerDay, day.wakeTs, day.sleepTs, trackFrom, now) - day.count;
}

export interface AvoidedResult {
  /** Ganze Zigaretten, nie negativ. */
  total: number;
  raw: number;
  perDay: number[];
}

export function calculateAvoidedCigarettes(
  baselinePerDay: number,
  days: AvoidedDayInput[],
  trackFrom: number,
  now: number,
): AvoidedResult {
  const perDay = days.map((d) => avoidedForDay(baselinePerDay, d, trackFrom, now));
  const raw = perDay.reduce((a, b) => a + b, 0);
  return { total: wholeAvoided(raw), raw, perDay };
}

export function wholeAvoided(raw: number): number {
  return Math.max(0, Math.floor(raw + 1e-9));
}

export function pricePerCigarette(packPrice: number, cigarettesPerPack: number): number {
  return cigarettesPerPack > 0 ? packPrice / cigarettesPerPack : 0;
}

export function calculateMoneySaved(avoided: number, packPrice: number, cigarettesPerPack: number): number {
  return Math.max(0, avoided) * pricePerCigarette(packPrice, cigarettesPerPack);
}

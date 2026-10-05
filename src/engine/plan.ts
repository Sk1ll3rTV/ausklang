import type { PlanStep } from '../domain/types';
import { statusLimits } from './status';

/**
 * Adaptiver Reduktionspfad.
 *
 * Kernidee: Ein kontinuierliches internes Niveau (`level`) sinkt Tag für Tag. Wie stark, hängt
 * vom Vortag ab. Das Niveau kann NIE steigen – gute Tage beschleunigen, schwierige Tage halten.
 * Dokumentation: docs/REDUCTION-ENGINE.md
 */

export interface PlanParams {
  baseline: number;
  minDays: number;
  maxDays: number;
}

/** Ergebnis eines abgeschlossenen Tages, wie es die Engine sieht. */
export interface DayOutcome {
  /** false = unbeobachtet oder zu lückenhaft → Niveau bleibt unverändert. */
  usable: boolean;
  /** Tagesmenge (bei angebrochenem Starttag hochgerechnet). */
  count: number;
  /** Verlangen mit Stärke ≥ 7. */
  strongCravings: number;
  cravingsResolved: number;
  cravingsPassed: number;
}

export interface PlanState {
  level: number;
  overStreak: number;
  underStreak: number;
  /** Letzte auswertbare Tagesmengen ohne Ausreißer (max. 7). */
  recent: number[];
}

export interface PlanDay {
  level: number;
  target: number;
  range: { min: number; max: number };
  /** Wie dieses Ziel aus dem Vortag entstanden ist. */
  step: PlanStep;
  notes: string[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Reguläre Reduktion pro Tag: Baseline verteilt auf die Mitte des Zielkorridors. */
export function nominalStep(p: PlanParams): number {
  const days = Math.max(1, (p.minDays + p.maxDays) / 2);
  return p.baseline / days;
}

export function initialPlanState(p: PlanParams): PlanState {
  // Erster Schritt des Pfads (20 → 17–18): Der Nutzer reduziert bereits.
  return { level: p.baseline * 0.9, overStreak: 0, underStreak: 0, recent: [] };
}

export function targetFromLevel(level: number): { target: number; range: { min: number; max: number } } {
  const target = level < 0.75 ? 0 : Math.round(level);
  return { target, range: { min: Math.max(0, target - 1), max: target } };
}

/** Viele starke Verlangen, die überwiegend nicht überstanden wurden → Tempo drosseln. */
export function isCravingStrainHigh(o: DayOutcome): boolean {
  if (o.strongCravings < 3 || o.cravingsResolved < 2) return false;
  return o.cravingsPassed / o.cravingsResolved < 0.5;
}

export function advancePlan(
  state: PlanState,
  o: DayOutcome,
  p: PlanParams,
): { state: PlanState; step: PlanStep; notes: string[] } {
  if (!o.usable) {
    return { state, step: 'paused', notes: ['Keine auswertbaren Daten für den Vortag – Bereich bleibt unverändert.'] };
  }

  const L = state.level;
  const s = nominalStep(p);
  const { target } = targetFromLevel(L);
  const limits = statusLimits(target);
  const notes: string[] = [];
  const strain = isCravingStrainHigh(o);

  const avg7 = state.recent.length >= 3 ? mean(state.recent) : null;
  const isOutlier = avg7 !== null && o.count > limits.green && o.count > avg7 + Math.max(3, avg7 * 0.4);

  let next = L;
  let step: PlanStep;
  let overStreak = state.overStreak;
  let underStreak = state.underStreak;

  if (isOutlier) {
    step = 'outlier';
    underStreak = 0;
    notes.push('Der Vortag war ein deutlicher Ausreißer gegenüber den letzten Tagen – Bereich wird gehalten.');
  } else if (o.count > limits.green) {
    overStreak += 1;
    underStreak = 0;
    if (o.count > limits.red || overStreak >= 2) {
      step = 'held';
      notes.push(
        overStreak >= 2
          ? 'Zwei Tage in Folge über dem Bereich – Bereich wird gehalten, nicht verschärft.'
          : 'Der Vortag lag deutlich über dem Bereich – Bereich wird gehalten.',
      );
    } else {
      step = 'slowed';
      next = L - s * 0.5;
      notes.push('Der Vortag lag etwas über dem Bereich – es geht mit halbem Tempo weiter.');
    }
  } else {
    overStreak = 0;
    const clearlyUnder = o.count <= L - Math.max(1.5, L * 0.15);
    if (clearlyUnder && !strain) {
      underStreak += 1;
      const gain = underStreak >= 2 ? 0.6 : 0.4;
      step = 'accelerated';
      next = L - s - gain * (L - o.count);
      notes.push(
        underStreak >= 2
          ? 'Mehrere Tage klar unter dem Bereich – die nächste Stufe wird schneller erreicht.'
          : 'Der Vortag lag klar unter dem Bereich – ein Teil dieses Vorsprungs wird übernommen.',
      );
    } else {
      underStreak = clearlyUnder ? underStreak : 0;
      step = strain ? 'slowed' : 'normal';
      next = L - s * (strain ? 0.5 : 1);
      notes.push(
        strain
          ? 'Viele starke Verlangen am Vortag – es geht mit halbem Tempo weiter.'
          : 'Der Vortag lag im Bereich – regulärer Schritt.',
      );
    }
  }

  const recent = isOutlier ? state.recent : [...state.recent, o.count].slice(-7);

  // Was real seit drei Tagen niedriger liegt, wird nicht wieder „erlaubt“.
  // Gilt nicht nach einem Tag über dem Bereich: Schwierige Tage verschärfen nie.
  if (recent.length >= 3 && o.count <= limits.green) {
    const ceiling = mean(recent.slice(-3)) + 0.5;
    if (ceiling < next) {
      next = ceiling;
      if (step !== 'accelerated') step = 'accelerated';
      notes.push('Der Schnitt der letzten drei Tage liegt unter dem Plan – der Bereich folgt dem tatsächlichen Verlauf.');
    }
  }

  // Invariante: Das Niveau steigt nie.
  next = Math.max(0, Math.min(L, next));
  return { state: { level: next, overStreak, underStreak, recent }, step, notes };
}

function toPlanDay(state: PlanState, step: PlanStep, notes: string[]): PlanDay {
  return { level: state.level, ...targetFromLevel(state.level), step, notes };
}

/**
 * Faltet die abgeschlossenen Tage zu einem Plan pro Tag.
 * Ergebnis hat `outcomes.length + 1` Einträge: Index i ist der Plan für Tag i,
 * der letzte Eintrag ist der Plan für den Tag nach dem letzten Ergebnis (heute).
 */
export function runPlan(outcomes: DayOutcome[], p: PlanParams): PlanDay[] {
  let state = initialPlanState(p);
  const days: PlanDay[] = [toPlanDay(state, 'start', ['Startbereich: erste Stufe unter dem Ausgangsniveau.'])];
  for (const o of outcomes) {
    const r = advancePlan(state, o, p);
    state = r.state;
    days.push(toPlanDay(state, r.step, r.notes));
  }
  return days;
}

/** Plan für den Tag nach `history`. */
export function calculateDailyPlan(history: DayOutcome[], p: PlanParams): PlanDay {
  const days = runPlan(history, p);
  return days[days.length - 1];
}

export interface ZeroForecast {
  minDays: number;
  maxDays: number;
}

/**
 * Spanne, in der 0 erreicht werden könnte, wenn sich der Trend hält.
 * `recentLevels`: Niveaus der letzten Tage (ältester zuerst, inkl. heute).
 */
export function estimateDaysToZero(recentLevels: number[], p: PlanParams): ZeroForecast | null {
  if (!recentLevels.length) return null;
  const level = recentLevels[recentLevels.length - 1];
  if (level < 0.75) return { minDays: 0, maxDays: 0 };
  const s = nominalStep(p);
  const span = recentLevels.length - 1;
  const observedPace = span >= 2 ? (recentLevels[0] - level) / span : s;
  const fast = Math.max(s, observedPace);
  const slow = Math.max(s * 0.5, Math.min(s, observedPace) * 0.75);
  return { minDays: Math.max(1, Math.ceil(level / fast)), maxDays: Math.max(1, Math.ceil(level / slow)) };
}

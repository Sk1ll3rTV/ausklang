/**
 * Erste Zigarette des Tages: ein „guter Bereich“, der sich adaptiv nach hinten schiebt.
 * Alle Werte in Minuten nach dem Aufstehen. Der Bereich wandert nie wieder nach vorne.
 */

export interface FirstCigParams {
  baselineDelayMin: number;
  wakeDurationMin: number;
}

export interface FirstCigState {
  startDelay: number;
  hitStreak: number;
  /** Verzögerungen der letzten auswertbaren Tage (max. 7). */
  recent: number[];
}

export interface FirstCigOutcome {
  usable: boolean;
  /** null = an diesem Tag wurde nicht geraucht. */
  firstDelayMin: number | null;
  /** Starkes Verlangen (≥ 7) am Morgen vor der ersten Zigarette. */
  strongMorningCraving: boolean;
}

const round5 = (x: number) => Math.round(x / 5) * 5;
const floor5 = (x: number) => Math.floor(x / 5) * 5;

export function firstCigWindowWidth(startDelay: number): number {
  return startDelay >= 60 ? 30 : 20;
}

function shiftStep(startDelay: number): number {
  return startDelay >= 60 ? 30 : 25;
}

export function initialFirstCigState(p: FirstCigParams): FirstCigState {
  return { startDelay: round5(p.baselineDelayMin + 15), hitStreak: 0, recent: [] };
}

/** Toleranz, mit der ein Bereich noch als „relativ problemlos erreicht“ gilt. */
const HIT_GRACE_MIN = 5;
/** Tage in Folge, nach denen der Bereich weiterwandert. */
const HITS_TO_SHIFT = 2;

export function advanceFirstCig(state: FirstCigState, o: FirstCigOutcome, p: FirstCigParams): FirstCigState {
  if (!o.usable) return state;
  const maxStart = Math.max(state.startDelay, p.wakeDurationMin - 120);
  const delay = Math.min(o.firstDelayMin ?? p.wakeDurationMin, p.wakeDurationMin);
  const recent = [...state.recent, delay].slice(-7);
  const width = firstCigWindowWidth(state.startDelay);

  const hit = delay >= state.startDelay - HIT_GRACE_MIN && !o.strongMorningCraving;
  let hitStreak = hit ? state.hitStreak + 1 : 0;
  let startDelay = state.startDelay;

  // Freiwillig deutlich später – an zwei Tagen in Folge – wird als neuer Stand übernommen.
  const lastTwo = recent.slice(-2);
  const sustained = lastTwo.length === 2 ? Math.min(...lastTwo) : null;
  if (sustained !== null && sustained >= startDelay + width + 15) {
    startDelay = Math.max(startDelay + shiftStep(startDelay), floor5(sustained - firstCigWindowWidth(sustained)));
    hitStreak = 0;
  } else if (hitStreak >= HITS_TO_SHIFT) {
    startDelay += shiftStep(startDelay);
    hitStreak = 0;
  }

  return { startDelay: Math.min(maxStart, Math.max(state.startDelay, startDelay)), hitStreak, recent };
}

export interface FirstCigTarget {
  startDelay: number;
  endDelay: number;
}

export function targetFromState(state: FirstCigState): FirstCigTarget {
  return { startDelay: state.startDelay, endDelay: state.startDelay + firstCigWindowWidth(state.startDelay) };
}

/** Faltet die Tage; Ergebnis hat `outcomes.length + 1` Zustände (letzter = heute). */
export function runFirstCig(outcomes: FirstCigOutcome[], p: FirstCigParams): FirstCigState[] {
  let state = initialFirstCigState(p);
  const states = [state];
  for (const o of outcomes) {
    state = advanceFirstCig(state, o, p);
    states.push(state);
  }
  return states;
}

export function calculateFirstCigaretteTarget(history: FirstCigOutcome[], p: FirstCigParams): FirstCigTarget {
  const states = runFirstCig(history, p);
  return targetFromState(states[states.length - 1]);
}

import { STRONG_CRAVING } from '../domain/defaults';
import {
  HOUR,
  MIN,
  addDays,
  dayClock,
  dayEnd,
  dayKeyOf,
  dayRange,
  dayStart,
  formatMinutes,
  formatTime,
  sleepTime,
  wakeTime,
  type DayClock,
} from '../domain/time';
import type {
  CigaretteEvent,
  CravingEvent,
  DailyPlan,
  DailySummary,
  DayKey,
  DayStatus,
  Settings,
} from '../domain/types';
import { avoidedForDay, calculateMoneySaved, pricePerCigarette, wholeAvoided } from './avoided';
import { runFirstCig, targetFromState, type FirstCigOutcome, type FirstCigParams } from './firstCigarette';
import { estimateDaysToZero, runPlan, type DayOutcome, type PlanParams, type ZeroForecast } from './plan';
import { buildCumulativeShare, calculateDailyStatus, finalDayStatus } from './status';

export interface EngineInput {
  settings: Settings;
  cigarettes: CigaretteEvent[];
  cravings: CravingEvent[];
  /** Tage, an denen die App geöffnet oder der Tag bestätigt wurde. */
  observedDays: DayKey[];
  now: number;
}

export interface DayRecord {
  date: DayKey;
  isToday: boolean;
  complete: boolean;
  observed: boolean;
  /** Anteil der Wachzeit, der seit Planstart erfasst ist (nur am Starttag < 1). */
  coverage: number;
  /** Geht dieser Tag in die adaptive Planung ein? */
  usable: boolean;
  startTs: number;
  endTs: number;
  wakeTs: number;
  sleepTs: number;
  cigarettes: CigaretteEvent[];
  cravings: CravingEvent[];
  plan: DailyPlan;
  summary: DailySummary;
  avoidedRaw: number;
}

export interface FirstCigaretteInfo {
  /** Bei Ziel 0 ohne Zigarette gibt es nichts Sinnvolles anzuzeigen. */
  relevant: boolean;
  targetStart: string;
  targetEnd: string;
  actualTs: number | null;
  laterThanBaselineMin: number | null;
  laterThanAverageMin: number | null;
}

export interface AppModel {
  now: number;
  clock: DayClock;
  todayKey: DayKey;
  days: DayRecord[];
  today: DayRecord;
  totals: { avoided: number; moneySaved: number };
  pricePerCigarette: number;
  activeCravings: CravingEvent[];
  firstCigarette: FirstCigaretteInfo;
  forecast: ZeroForecast | null;
  usableDays: number;
}

/** Ab diesem Anteil erfasster Wachzeit wird der Starttag hochgerechnet statt ignoriert. */
const MIN_COVERAGE = 0.75;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function groupByDay<T>(items: T[], ts: (x: T) => number, clock: DayClock): Map<DayKey, T[]> {
  const map = new Map<DayKey, T[]>();
  for (const item of [...items].sort((a, b) => ts(a) - ts(b))) {
    const key = dayKeyOf(ts(item), clock);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function planParams(settings: Settings): PlanParams {
  return {
    baseline: settings.baselineCigarettesPerDay,
    minDays: settings.cessationTargetMinDays,
    maxDays: settings.cessationTargetMaxDays,
  };
}

/**
 * Leitet aus Rohdaten den kompletten App-Zustand ab. Reine Funktion: Jede Änderung an
 * Events (anlegen, bearbeiten, löschen) führt beim nächsten Aufruf zu neu berechneten Tageswerten.
 */
export function buildModel(input: EngineInput): AppModel {
  const { settings, now } = input;
  const clock = dayClock(settings.usualWakeTime, settings.usualSleepTime);
  const todayKey = dayKeyOf(now, clock);
  const startKey = settings.currentPlanStartDate <= todayKey ? settings.currentPlanStartDate : todayKey;
  const dates = dayRange(startKey, todayKey);
  const baseline = settings.baselineCigarettesPerDay;
  const price = pricePerCigarette(settings.packPrice, settings.cigarettesPerPack);

  const cigsByDay = groupByDay(input.cigarettes, (c) => c.timestamp, clock);
  const cravingsByDay = groupByDay(input.cravings, (c) => c.startTimestamp, clock);
  const marked = new Set(input.observedDays);

  const base = dates.map((date) => {
    const wakeTs = wakeTime(date, clock);
    const sleepTs = sleepTime(date, clock);
    const cigarettes = cigsByDay.get(date) ?? [];
    const cravings = cravingsByDay.get(date) ?? [];
    const isToday = date === todayKey;
    const observed = isToday || marked.has(date) || cigarettes.length > 0 || cravings.length > 0;
    const coverage =
      date === startKey
        ? Math.min(1, Math.max(0, (sleepTs - Math.max(wakeTs, settings.planStartedAt)) / (sleepTs - wakeTs)))
        : 1;
    const usable = !isToday && observed && coverage >= MIN_COVERAGE;
    return { date, isToday, wakeTs, sleepTs, cigarettes, cravings, observed, coverage, usable };
  });

  // --- Reduktionspfad -------------------------------------------------------
  const past = base.filter((d) => !d.isToday);
  const outcomes: DayOutcome[] = past.map((d) => {
    const resolved = d.cravings.filter((c) => c.outcome !== 'active');
    return {
      usable: d.usable,
      count: d.usable ? d.cigarettes.length / d.coverage : d.cigarettes.length,
      strongCravings: d.cravings.filter((c) => c.intensityInitial >= STRONG_CRAVING).length,
      cravingsResolved: resolved.length,
      cravingsPassed: resolved.filter((c) => c.outcome === 'passed').length,
    };
  });
  const params = planParams(settings);
  const plans = runPlan(outcomes, params);

  // --- Erste Zigarette ------------------------------------------------------
  const fcParams: FirstCigParams = {
    baselineDelayMin: settings.baselineFirstCigaretteDelayMin,
    wakeDurationMin: clock.wakeDurationMin,
  };
  const firstDelay = (d: (typeof base)[number]) =>
    d.cigarettes.length ? (d.cigarettes[0].timestamp - d.wakeTs) / MIN : null;
  const fcUsable = (d: (typeof base)[number]) =>
    d.observed && !d.isToday && (d.date !== startKey || settings.planStartedAt <= d.wakeTs + 30 * MIN);
  const fcOutcomes: FirstCigOutcome[] = past.map((d) => {
    const first = d.cigarettes[0]?.timestamp ?? Infinity;
    return {
      usable: fcUsable(d),
      firstDelayMin: firstDelay(d),
      strongMorningCraving: d.cravings.some(
        (c) =>
          c.intensityInitial >= STRONG_CRAVING &&
          c.startTimestamp >= d.wakeTs - 30 * MIN &&
          c.startTimestamp <= d.wakeTs + 3 * HOUR &&
          c.startTimestamp <= first,
      ),
    };
  });
  const fcStates = runFirstCig(fcOutcomes, fcParams);

  // --- Tageszeitprofil (letzte 14 auswertbare Tage) --------------------------
  const samples: number[] = [];
  for (const d of past.filter((x) => x.usable).slice(-14)) {
    for (const c of d.cigarettes) samples.push((c.timestamp - d.wakeTs) / (d.sleepTs - d.wakeTs));
  }
  const shareAt = buildCumulativeShare(samples);

  const usableCounts = outcomes.filter((o) => o.usable).map((o) => o.count);
  const usableDays = usableCounts.length;
  const confidence = Math.min(1, usableDays / 7);

  // --- Tagesdatensätze ------------------------------------------------------
  const days: DayRecord[] = base.map((d, i) => {
    const plan = plans[i];
    const fc = targetFromState(fcStates[i]);
    const count = d.cigarettes.length;

    let status: DayStatus | null = null;
    let projected = count;
    if (d.isToday) {
      const recent = usableCounts.slice(-3);
      const prior = Math.min(recent.length ? mean(recent) : plan.target, plan.target);
      const live = calculateDailyStatus({
        target: plan.target,
        cigaretteTimes: d.cigarettes.map((c) => c.timestamp),
        now,
        wakeTs: d.wakeTs,
        sleepTs: d.sleepTs,
        shareAt,
        prior,
      });
      status = live.status;
      projected = live.projected;
    } else if (d.observed) {
      projected = d.coverage >= MIN_COVERAGE ? count / d.coverage : count;
      // Ein zu kurz erfasster Starttag wird nicht bewertet.
      status = d.coverage >= MIN_COVERAGE ? finalDayStatus(projected, plan.target) : null;
    }

    const avoidedRaw = avoidedForDay(
      baseline,
      { wakeTs: d.wakeTs, sleepTs: d.sleepTs, count, observed: d.observed },
      settings.planStartedAt,
      now,
    );
    const avoided = wholeAvoided(avoidedRaw);
    const resolved = d.cravings.filter((c) => c.outcome === 'passed');

    return {
      ...d,
      complete: !d.isToday,
      startTs: dayStart(d.date, clock),
      endTs: dayEnd(d.date, clock),
      avoidedRaw,
      plan: {
        date: d.date,
        internalTarget: plan.target,
        internalTargetRange: plan.range,
        firstCigaretteTargetStart: formatMinutes(clock.wakeMin + fc.startDelay),
        firstCigaretteTargetEnd: formatMinutes(clock.wakeMin + fc.endDelay),
        status,
        projectedConsumption: Math.round(projected * 10) / 10,
        modelConfidence: confidence,
        generatedReasoning: {
          level: Math.round(plan.level * 100) / 100,
          step: plan.step,
          notes: plan.notes,
          firstCigaretteStartDelayMin: fc.startDelay,
        },
      },
      summary: {
        date: d.date,
        totalCigarettes: count,
        firstCigaretteTime: count ? formatTime(d.cigarettes[0].timestamp) : null,
        cravings: d.cravings.length,
        cravingsPassed: resolved.length,
        avoidedCigarettes: avoided,
        moneySaved: calculateMoneySaved(avoided, settings.packPrice, settings.cigarettesPerPack),
        status,
        observed: d.observed,
      },
    };
  });

  const today = days[days.length - 1];
  const totalAvoided = wholeAvoided(days.reduce((sum, d) => sum + d.avoidedRaw, 0));

  // --- Erste Zigarette heute: nur sinnvolle Vergleiche ------------------------
  const actualTs = today.cigarettes[0]?.timestamp ?? null;
  const todayDelay = actualTs === null ? null : (actualTs - today.wakeTs) / MIN;
  const priorDelays = past
    .filter(fcUsable)
    .slice(-7)
    .map(firstDelay)
    .filter((x): x is number => x !== null);
  const diffBaseline = todayDelay === null ? null : Math.round(todayDelay - settings.baselineFirstCigaretteDelayMin);
  const diffAverage =
    todayDelay === null || priorDelays.length < 3 ? null : Math.round(todayDelay - mean(priorDelays));

  const levels = plans.slice(-5).map((p) => p.level);

  return {
    now,
    clock,
    todayKey,
    days,
    today,
    totals: {
      avoided: totalAvoided,
      moneySaved: calculateMoneySaved(totalAvoided, settings.packPrice, settings.cigarettesPerPack),
    },
    pricePerCigarette: price,
    activeCravings: input.cravings
      .filter((c) => c.outcome === 'active')
      .sort((a, b) => b.startTimestamp - a.startTimestamp),
    firstCigarette: {
      relevant: actualTs !== null || today.plan.internalTarget > 0,
      targetStart: today.plan.firstCigaretteTargetStart,
      targetEnd: today.plan.firstCigaretteTargetEnd,
      actualTs,
      laterThanBaselineMin: diffBaseline !== null && diffBaseline >= 5 ? diffBaseline : null,
      laterThanAverageMin: diffAverage !== null && diffAverage >= 10 ? diffAverage : null,
    },
    forecast: estimateDaysToZero(levels, params),
    usableDays,
  };
}

/** Hilfsfunktion für Tests und Verlauf: Tagesdatensatz zu einem Datum. */
export function findDay(model: AppModel, date: DayKey): DayRecord | undefined {
  return model.days.find((d) => d.date === date);
}

export { addDays };

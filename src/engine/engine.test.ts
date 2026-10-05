import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../domain/defaults';
import { HOUR, MIN, addDays, dayClock, dayKeyOf } from '../domain/time';
import type { CigaretteEvent, CravingEvent, Settings } from '../domain/types';
import {
  advanceFirstCig,
  advancePlan,
  buildCumulativeShare,
  buildModel,
  calculateAvoidedCigarettes,
  calculateDailyPlan,
  calculateDailyStatus,
  calculateFirstCigaretteTarget,
  calculateMoneySaved,
  calculateProjectedConsumption,
  classifyStatus,
  estimateDaysToZero,
  expectedBaseline,
  finalDayStatus,
  findDay,
  initialFirstCigState,
  initialPlanState,
  runPlan,
  type DayOutcome,
  type FirstCigOutcome,
  type PlanParams,
} from './index';

const P: PlanParams = { baseline: 20, minDays: 14, maxDays: 21 };
const at = (day: number, h: number, m = 0) => new Date(2026, 0, day, h, m).getTime();
const outcome = (count: number, extra: Partial<DayOutcome> = {}): DayOutcome => ({
  usable: true,
  count,
  strongCravings: 0,
  cravingsResolved: 0,
  cravingsPassed: 0,
  ...extra,
});

let seq = 0;
const cig = (timestamp: number, extra: Partial<CigaretteEvent> = {}): CigaretteEvent => ({
  id: `c${++seq}`,
  timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...extra,
});
const craving = (startTimestamp: number, extra: Partial<CravingEvent> = {}): CravingEvent => ({
  id: `v${++seq}`,
  startTimestamp,
  intensityInitial: 5,
  outcome: 'passed',
  createdAt: startTimestamp,
  updatedAt: startTimestamp,
  ...extra,
});

/** Plan startet am 5. Januar 2026 um 07:00 (Aufstehzeit). */
function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(at(5, 7)),
    onboarded: true,
    currentPlanStartDate: '2026-01-05',
    planStartedAt: at(5, 7),
    ...overrides,
  };
}

/** n Zigaretten gleichmäßig zwischen 08:00 und 22:00 an einem Tag. */
function spread(day: number, n: number): CigaretteEvent[] {
  return Array.from({ length: n }, (_, i) => cig(at(day, 8) + (i * 14 * HOUR) / Math.max(1, n)));
}

describe('Zeitmodell', () => {
  const clock = dayClock('07:00', '00:00');
  it('wechselt den logischen Tag in der Schlafmitte, nicht um Mitternacht', () => {
    expect(clock.wakeDurationMin).toBe(17 * 60);
    expect(dayKeyOf(at(6, 0, 30), clock)).toBe('2026-01-05');
    expect(dayKeyOf(at(6, 3, 29), clock)).toBe('2026-01-05');
    expect(dayKeyOf(at(6, 3, 30), clock)).toBe('2026-01-06');
  });
  it('kommt mit Schlaf vor Mitternacht zurecht', () => {
    const c = dayClock('06:00', '22:00');
    expect(c.wakeDurationMin).toBe(16 * 60);
    expect(dayKeyOf(at(6, 1, 59), c)).toBe('2026-01-05');
    expect(dayKeyOf(at(6, 2, 0), c)).toBe('2026-01-06');
  });
});

describe('calculateAvoidedCigarettes', () => {
  const wakeTs = at(5, 7);
  const sleepTs = at(6, 0);
  const day = (count: number) => ({ wakeTs, sleepTs, count, observed: true });

  it('baut die Baseline nur in der Wachzeit auf (ca. 1,176 pro Stunde)', () => {
    expect(expectedBaseline(20, wakeTs, sleepTs, 0, at(5, 8))).toBeCloseTo(20 / 17, 5);
    expect(expectedBaseline(20, wakeTs, sleepTs, 0, at(5, 6))).toBe(0);
    expect(expectedBaseline(20, wakeTs, sleepTs, 0, at(6, 5))).toBe(20);
  });

  it('entspricht dem Beispiel: ~10 erwartet um 15:30, 6 geraucht → 4 vermieden', () => {
    const r = calculateAvoidedCigarettes(20, [day(6)], 0, at(5, 15, 30));
    expect(r.total).toBe(4);
  });

  it('Nacht zählt nicht als vermiedene Zigaretten', () => {
    const s = settings();
    const cigarettes = spread(5, 12);
    const model = (now: number) => buildModel({ settings: s, cigarettes, cravings: [], observedDays: [], now });
    const atMidnight = model(at(6, 0, 0)).totals.avoided;
    expect(atMidnight).toBe(8);
    expect(model(at(6, 2, 0)).totals.avoided).toBe(atMidnight);
    expect(model(at(6, 3, 45)).totals.avoided).toBe(atMidnight);
    expect(model(at(6, 6, 59)).totals.avoided).toBe(atMidnight);
    expect(model(at(6, 10, 0)).totals.avoided).toBeGreaterThan(atMidnight);
  });

  it('zeigt den Gesamtwert nie negativ', () => {
    expect(calculateAvoidedCigarettes(20, [day(9)], 0, at(5, 9)).total).toBe(0);
  });

  it('zählt nichts vor dem Planstart und nichts an unbeobachteten Tagen', () => {
    expect(calculateAvoidedCigarettes(20, [day(0)], at(5, 15, 30), at(5, 15, 30)).total).toBe(0);
    expect(calculateAvoidedCigarettes(20, [{ ...day(0), observed: false }], 0, at(6, 5)).total).toBe(0);
  });
});

describe('Geldberechnung', () => {
  it('rechnet 12 € / 28 Zigaretten pro vermiedener Zigarette', () => {
    expect(calculateMoneySaved(1, 12, 28)).toBeCloseTo(0.428571, 5);
    expect(calculateMoneySaved(37, 12, 28).toFixed(2)).toBe('15.86');
    expect(calculateMoneySaved(-3, 12, 28)).toBe(0);
    expect(calculateMoneySaved(5, 12, 0)).toBe(0);
  });
});

describe('calculateDailyPlan', () => {
  it('startet eine Stufe unter der Baseline (17–18)', () => {
    const plan = calculateDailyPlan([], P);
    expect(plan.range).toEqual({ min: 17, max: 18 });
  });

  it('erreicht bei planmäßigem Verlauf 0 innerhalb von 14–21 Tagen', () => {
    const history: DayOutcome[] = [];
    let day = 1;
    for (; day < 40; day++) {
      const plan = calculateDailyPlan(history, P);
      if (plan.target === 0) break;
      history.push(outcome(plan.target));
    }
    expect(day).toBeGreaterThanOrEqual(14);
    expect(day).toBeLessThanOrEqual(21);
  });

  it('niedrigere tatsächliche Menge erhöht kein späteres Ziel', () => {
    const base = [18, 17, 16, 15, 14, 13, 12].map((c) => outcome(c));
    const before = calculateDailyPlan(base, P);
    const planned = before.target;
    const after = calculateDailyPlan([...base, outcome(planned - 3)], P);
    expect(after.target).toBeLessThan(planned);
    expect(after.step).toBe('accelerated');
    // Auch nach schwierigen Folgetagen taucht das alte Ziel nicht wieder auf.
    const later = runPlan([...base, outcome(planned - 3), outcome(planned + 3), outcome(planned + 3)], P);
    for (const d of later.slice(base.length + 1)) expect(d.target).toBeLessThan(planned);
  });

  it('das Niveau steigt in keinem Szenario', () => {
    const counts = [18, 25, 3, 30, 30, 0, 12, 40, 5, 5, 5, 22, 1, 0, 9];
    const days = runPlan(counts.map((c) => outcome(c)), P);
    for (let i = 1; i < days.length; i++) expect(days[i].level).toBeLessThanOrEqual(days[i - 1].level);
  });

  it('schwieriger Tag setzt Fortschritt nicht zurück', () => {
    const base = [18, 17, 16, 15].map((c) => outcome(c));
    const before = calculateDailyPlan(base, P);
    const after = calculateDailyPlan([...base, outcome(before.target + 9)], P);
    expect(after.level).toBe(before.level);
    expect(['held', 'outlier']).toContain(after.step);
  });

  it('hält nach zwei schwierigen Tagen und verschärft nicht zusätzlich', () => {
    const state = { ...initialPlanState(P), level: 12 };
    const first = advancePlan(state, outcome(14.5), P);
    expect(first.step).toBe('slowed');
    expect(first.state.level).toBeLessThan(12);
    const second = advancePlan(first.state, outcome(14.5), P);
    expect(second.step).toBe('held');
    expect(second.state.level).toBe(first.state.level);
  });

  it('verschärft nach einem Tag über dem Bereich nicht über den 3-Tage-Schnitt', () => {
    const state = { level: 10, overStreak: 0, underStreak: 0, recent: [6, 6] };
    const r = advancePlan(state, outcome(14), P);
    expect(r.state.level).toBe(10);
  });

  it('beschleunigt stärker nach mehreren klar besseren Tagen', () => {
    const state = { ...initialPlanState(P), level: 12 };
    const one = advancePlan(state, outcome(8), P);
    const regular = advancePlan(state, outcome(12), P);
    expect(one.state.level).toBeLessThan(regular.state.level);
    const two = advancePlan(one.state, outcome(6), P);
    expect(two.step).toBe('accelerated');
    expect(two.state.underStreak).toBe(2);
  });

  it('drosselt bei vielen starken, nicht überstandenen Verlangen', () => {
    const state = { ...initialPlanState(P), level: 12 };
    const calm = advancePlan(state, outcome(12), P);
    const strained = advancePlan(
      state,
      outcome(12, { strongCravings: 4, cravingsResolved: 4, cravingsPassed: 1 }),
      P,
    );
    expect(strained.step).toBe('slowed');
    expect(strained.state.level).toBeGreaterThan(calm.state.level);
    expect(strained.state.level).toBeLessThan(12);
  });

  it('lässt unbeobachtete Tage unverändert', () => {
    const state = { ...initialPlanState(P), level: 9 };
    expect(advancePlan(state, outcome(0, { usable: false }), P).state.level).toBe(9);
  });

  it('schätzt eine plausible Spanne bis 0', () => {
    const f = estimateDaysToZero([12, 10.9, 9.7, 8.6], P)!;
    expect(f.minDays).toBeGreaterThanOrEqual(1);
    expect(f.maxDays).toBeGreaterThanOrEqual(f.minDays);
    expect(estimateDaysToZero([0.3], P)).toEqual({ minDays: 0, maxDays: 0 });
  });
});

describe('calculateDailyStatus', () => {
  const wakeTs = at(5, 7);
  const sleepTs = at(6, 0);
  const uniform = buildCumulativeShare([]);
  const status = (target: number, times: number[], now: number, prior = target) =>
    calculateDailyStatus({ target, cigaretteTimes: times, now, wakeTs, sleepTs, shareAt: uniform, prior });

  it('Status Rot erscheint nicht zu früh', () => {
    // Drei Zigaretten in der ersten Stunde bei Ziel 10 – deutlich schneller als üblich.
    const early = [at(5, 7, 10), at(5, 7, 30), at(5, 7, 50)];
    expect(status(10, early, at(5, 8)).status).not.toBe('red');
    // Eine einzelne frühe Zigarette bleibt grün.
    expect(status(10, [at(5, 7, 5)], at(5, 7, 10)).status).toBe('green');
  });

  it('wird rot, wenn der Tag wirklich deutlich darüber liegt', () => {
    const many = Array.from({ length: 15 }, (_, i) => at(5, 8) + i * 40 * MIN);
    const r = status(10, many, at(5, 19));
    expect(r.status).toBe('red');
    expect(r.projected).toBeGreaterThan(13);
  });

  it('bleibt bei planmäßigem Tempo grün', () => {
    const times = Array.from({ length: 5 }, (_, i) => at(5, 8) + i * 90 * MIN);
    expect(status(10, times, at(5, 15, 30)).status).toBe('green');
  });

  it('grün ist großzügig, orange eine normale Abweichung', () => {
    expect(finalDayStatus(11, 10)).toBe('green');
    expect(finalDayStatus(12, 10)).toBe('orange');
    expect(finalDayStatus(13, 10)).toBe('orange');
    expect(finalDayStatus(14, 10)).toBe('red');
    expect(finalDayStatus(0, 0)).toBe('green');
    expect(finalDayStatus(1, 0)).toBe('orange');
    expect(finalDayStatus(3, 0)).toBe('red');
  });

  it('stabilisiert den Status mit Hysterese', () => {
    // Knapp über der Grün-Grenze (11) kippt Grün noch nicht …
    expect(classifyStatus(11.3, 10, 'green')).toBe('green');
    // … und Orange springt bei gleichem Wert nicht zurück.
    expect(classifyStatus(11.3, 10, 'orange')).toBe('orange');
    expect(classifyStatus(10.4, 10, 'orange')).toBe('green');
    expect(classifyStatus(13.2, 10, 'orange')).toBe('orange');
    expect(classifyStatus(13.2, 10, 'red')).toBe('red');
    expect(classifyStatus(20, 10, 'green', false)).toBe('orange');
  });

  it('die Prognose gewichtet früh die Erwartung, spät das tatsächliche Tempo', () => {
    expect(calculateProjectedConsumption({ count: 1, share: 0.02, prior: 14 })).toBeLessThan(15.5);
    expect(calculateProjectedConsumption({ count: 9, share: 1, prior: 14 })).toBe(9);
    expect(calculateProjectedConsumption({ count: 8, share: 0.5, prior: 10 })).toBeCloseTo(14.5, 5);
  });
});

describe('calculateFirstCigaretteTarget', () => {
  const FP = { baselineDelayMin: 20, wakeDurationMin: 17 * 60 };
  const fc = (delay: number | null, extra: Partial<FirstCigOutcome> = {}): FirstCigOutcome => ({
    usable: true,
    firstDelayMin: delay,
    strongMorningCraving: false,
    ...extra,
  });

  it('beginnt knapp hinter dem ursprünglichen Muster (07:35–07:55)', () => {
    expect(calculateFirstCigaretteTarget([], FP)).toEqual({ startDelay: 35, endDelay: 55 });
  });

  it('erste Zigarette kann adaptiv nach hinten geschoben werden', () => {
    expect(calculateFirstCigaretteTarget([fc(40)], FP).startDelay).toBe(35);
    expect(calculateFirstCigaretteTarget([fc(40), fc(45)], FP)).toEqual({ startDelay: 60, endDelay: 90 });
    const longer = calculateFirstCigaretteTarget([fc(40), fc(45), fc(65), fc(70)], FP);
    expect(longer).toEqual({ startDelay: 90, endDelay: 120 });
  });

  it('hält den Bereich, wenn er verfehlt wird – und schiebt nie nach vorne', () => {
    const t = calculateFirstCigaretteTarget([fc(40), fc(45), fc(10), fc(5), fc(8)], FP);
    expect(t.startDelay).toBe(60);
  });

  it('hält bei starkem morgendlichem Verlangen', () => {
    const t = calculateFirstCigaretteTarget([fc(40), fc(45, { strongMorningCraving: true })], FP);
    expect(t.startDelay).toBe(35);
  });

  it('übernimmt freiwillig deutlich spätere erste Zigaretten', () => {
    const t = calculateFirstCigaretteTarget([fc(150), fc(180)], FP);
    expect(t).toEqual({ startDelay: 120, endDelay: 150 });
    // Ein einzelner später Tag (z. B. Ausschlafen) reicht dafür nicht.
    expect(calculateFirstCigaretteTarget([fc(180)], FP).startDelay).toBe(35);
  });

  it('wertet rauchfreie Tage als erreicht und ignoriert unbrauchbare Tage', () => {
    let state = initialFirstCigState(FP);
    state = advanceFirstCig(state, fc(null, { usable: false }), FP);
    expect(state).toEqual(initialFirstCigState(FP));
    state = advanceFirstCig(state, fc(null), FP);
    expect(state.hitStreak).toBe(1);
  });
});

describe('buildModel', () => {
  const s = settings();

  it('Löschung eines Events berechnet Tageswerte neu', () => {
    const cigarettes = spread(5, 15);
    const now = at(6, 12);
    const before = buildModel({ settings: s, cigarettes, cravings: [], observedDays: [], now });
    const after = buildModel({ settings: s, cigarettes: cigarettes.slice(1), cravings: [], observedDays: [], now });
    const d0 = findDay(before, '2026-01-05')!;
    const d1 = findDay(after, '2026-01-05')!;
    expect(d0.summary.totalCigarettes).toBe(15);
    expect(d1.summary.totalCigarettes).toBe(14);
    expect(d1.summary.avoidedCigarettes).toBe(d0.summary.avoidedCigarettes + 1);
    expect(d1.summary.moneySaved).toBeCloseTo(d0.summary.moneySaved + 12 / 28, 5);
    expect(d1.summary.firstCigaretteTime).not.toBe(d0.summary.firstCigaretteTime);
    expect(after.totals.avoided).toBe(before.totals.avoided + 1);
  });

  it('ordnet nächtliche Zigaretten dem Vortag zu', () => {
    const model = buildModel({
      settings: s,
      cigarettes: [cig(at(6, 0, 40))],
      cravings: [],
      observedDays: [],
      now: at(6, 9),
    });
    expect(findDay(model, '2026-01-05')!.summary.totalCigarettes).toBe(1);
    expect(model.today.summary.totalCigarettes).toBe(0);
  });

  it('wertet Tage ohne jede Beobachtung nicht aus', () => {
    const cigarettes = spread(5, 18);
    const now = at(9, 12);
    const model = buildModel({ settings: s, cigarettes, cravings: [], observedDays: [], now });
    const gap = findDay(model, '2026-01-07')!;
    expect(gap.observed).toBe(false);
    expect(gap.summary.status).toBeNull();
    expect(gap.summary.avoidedCigarettes).toBe(0);
    // Das Ziel fällt in der Lücke nicht.
    expect(model.today.plan.internalTarget).toBe(findDay(model, '2026-01-06')!.plan.internalTarget);

    const confirmed = buildModel({
      settings: s,
      cigarettes,
      cravings: [],
      observedDays: ['2026-01-06', '2026-01-07', '2026-01-08'],
      now,
    });
    expect(findDay(confirmed, '2026-01-07')!.summary.avoidedCigarettes).toBe(20);
    expect(confirmed.today.plan.internalTarget).toBeLessThan(model.today.plan.internalTarget);
  });

  it('rechnet einen spät begonnenen Starttag nicht als guten Tag', () => {
    const late = settings({ planStartedAt: at(5, 18) });
    const model = buildModel({
      settings: late,
      cigarettes: [cig(at(5, 19)), cig(at(5, 21))],
      cravings: [],
      observedDays: [],
      now: at(6, 9),
    });
    expect(findDay(model, '2026-01-05')!.usable).toBe(false);
    expect(model.today.plan.generatedReasoning.step).toBe('paused');
    expect(model.today.plan.internalTargetRange).toEqual({ min: 17, max: 18 });
  });

  it('liefert Vergleiche zur ersten Zigarette nur, wenn sie sinnvoll sind', () => {
    const early = buildModel({
      settings: s,
      cigarettes: [cig(at(5, 7, 10))],
      cravings: [],
      observedDays: [],
      now: at(5, 9),
    });
    expect(early.firstCigarette.laterThanBaselineMin).toBeNull();
    const later = buildModel({
      settings: s,
      cigarettes: [cig(at(5, 8, 8))],
      cravings: [],
      observedDays: [],
      now: at(5, 9),
    });
    expect(later.firstCigarette.laterThanBaselineMin).toBe(48);
    expect(later.firstCigarette.targetStart).toBe('07:35');
  });

  it('zählt überstandene Verlangen und offene Verlangen', () => {
    const model = buildModel({
      settings: s,
      cigarettes: [],
      cravings: [
        craving(at(5, 8, 11), { outcome: 'passed', endTimestamp: at(5, 8, 19) }),
        craving(at(5, 9), { outcome: 'smoked' }),
        craving(at(5, 10), { outcome: 'active', intensityInitial: 8 }),
      ],
      observedDays: [],
      now: at(5, 10, 5),
    });
    expect(model.today.summary.cravings).toBe(3);
    expect(model.today.summary.cravingsPassed).toBe(1);
    expect(model.activeCravings).toHaveLength(1);
  });

  it('bleibt über einen ganzen simulierten Verlauf konsistent', () => {
    const cigarettes: CigaretteEvent[] = [];
    const observed: string[] = [];
    let target = 18;
    for (let i = 0; i < 20; i++) {
      const dayKey = addDays('2026-01-05', i);
      observed.push(dayKey);
      cigarettes.push(...spread(5 + i, target));
      const model = buildModel({ settings: s, cigarettes, cravings: [], observedDays: observed, now: at(6 + i, 9) });
      expect(model.today.plan.internalTarget).toBeLessThanOrEqual(target);
      target = model.today.plan.internalTarget;
    }
    expect(target).toBe(0);
  });
});

/**
 * Demo-Daten – ausschließlich für den Entwicklungsmodus (wird nur hinter `import.meta.env.DEV`
 * dynamisch geladen und landet nicht im Production-Bundle).
 */
import { defaultSettings } from '../domain/defaults';
import { HOUR, MIN, addDays, dayClock, dayKeyOf, wakeTime } from '../domain/time';
import type { CigaretteEvent, CravingEvent, DayMark } from '../domain/types';
import { db } from './db';

/** Deterministischer Zufall, damit die Demo bei jedem Laden gleich aussieht. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function loadDemoData(daysBack = 11): Promise<void> {
  const rand = rng(7);
  const now = Date.now();
  const base = defaultSettings(now);
  const clock = dayClock(base.usualWakeTime, base.usualSleepTime);
  const today = dayKeyOf(now, clock);
  const startDate = addDays(today, -daysBack);
  const planStartedAt = wakeTime(startDate, clock);

  const counts = [18, 17, 16, 17, 14, 13, 12, 15, 10, 9, 8, 4];
  const triggers = ['Kaffee', 'Stress', 'Autofahren', 'nach dem Essen', 'Gewohnheit', 'Arbeitspause'];
  const places = ['Zuhause', 'Auto', 'Arbeit', 'draußen'];
  const company = ['allein', 'allein', 'Kollegen', 'Freunde'];
  const cigarettes: CigaretteEvent[] = [];
  const cravings: CravingEvent[] = [];
  const dayMarks: DayMark[] = [];
  let id = 0;

  for (let i = 0; i <= daysBack; i++) {
    const date = addDays(startDate, i);
    dayMarks.push({ date, source: 'opened' });
    const wake = wakeTime(date, clock);
    const first = wake + (25 + i * 6 + rand() * 15) * MIN;
    const end = Math.min(wake + 16.2 * HOUR, now);
    const n = counts[i] ?? 8;
    for (let k = 0; k < n; k++) {
      const ts = k === 0 ? first : first + ((end - first) * (k + rand() * 0.6)) / n;
      if (ts > now) break;
      const tagged = rand() < 0.55;
      cigarettes.push({
        id: `demo-c${id++}`,
        timestamp: ts,
        createdAt: ts,
        updatedAt: ts,
        ...(tagged
          ? {
              trigger: triggers[Math.floor(rand() * triggers.length)],
              location: places[Math.floor(rand() * places.length)],
              companions: company[Math.floor(rand() * company.length)],
            }
          : {}),
      });
    }
    const cravingCount = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < cravingCount; k++) {
      const start = wake + (2 + rand() * 12) * HOUR;
      if (start > now - 10 * MIN) continue;
      const intensity = 3 + Math.floor(rand() * 7);
      const passed = rand() < (intensity >= 7 ? 0.5 : 0.8);
      cravings.push({
        id: `demo-v${id++}`,
        startTimestamp: start,
        endTimestamp: start + (4 + rand() * 9) * MIN,
        intensityInitial: intensity,
        intensityFinal: passed ? Math.max(1, intensity - 4) : intensity,
        outcome: passed ? 'passed' : 'smoked',
        trigger: triggers[Math.floor(rand() * triggers.length)],
        location: places[Math.floor(rand() * places.length)],
        copingStrategy: ['Atmen', '2 Minuten ablenken', 'Wasser trinken'][Math.floor(rand() * 3)],
        createdAt: start,
        updatedAt: start,
      });
    }
  }

  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.settings.put({ ...base, onboarded: true, currentPlanStartDate: startDate, planStartedAt });
    await db.cigarettes.bulkPut(cigarettes);
    await db.cravings.bulkPut(cravings);
    await db.dayMarks.bulkPut(dayMarks);
  });
}

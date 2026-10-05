import Dexie, { type Table } from 'dexie';
import type { CigaretteEvent, CravingEvent, DailyPlan, DailySummary, DayMark, Settings } from '../domain/types';

/**
 * Lokale IndexedDB. Rohdaten: settings, cigarettes, cravings, dayMarks.
 * dailyPlans / dailySummaries sind abgeleitete Schnappschüsse der Engine (jederzeit neu berechenbar).
 *
 * Schemaänderungen: neue `this.version(n).stores(...).upgrade(...)` ergänzen und
 * SCHEMA_VERSION in domain/types.ts erhöhen. Bestehende Versionen nie verändern.
 */
export class AusklangDB extends Dexie {
  settings!: Table<Settings, string>;
  cigarettes!: Table<CigaretteEvent, string>;
  cravings!: Table<CravingEvent, string>;
  dailyPlans!: Table<DailyPlan, string>;
  dailySummaries!: Table<DailySummary, string>;
  dayMarks!: Table<DayMark, string>;

  constructor() {
    super('ausklang');
    this.version(1).stores({
      settings: 'id',
      cigarettes: 'id, timestamp',
      cravings: 'id, startTimestamp, outcome',
      dailyPlans: 'date',
      dailySummaries: 'date',
      dayMarks: 'date',
    });
  }
}

export const db = new AusklangDB();

/** Bittet den Browser, die Daten nicht automatisch zu verwerfen (iOS/Safari: best effort). */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Nicht unterstützt – die App funktioniert trotzdem.
  }
}

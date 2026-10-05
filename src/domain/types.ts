/** Lokales Datenschema. Bei Änderungen SCHEMA_VERSION erhöhen und in persistence/db.ts migrieren. */
export const SCHEMA_VERSION = 1;

/** Logischer Tag im Format YYYY-MM-DD (siehe domain/time.ts – Tageswechsel liegt in der Schlafmitte). */
export type DayKey = string;

export type Appearance = 'system' | 'light' | 'dark';
export type DayStatus = 'green' | 'orange' | 'red';
export type CravingOutcome = 'active' | 'passed' | 'smoked';

export type ContextField = 'trigger' | 'mood' | 'location' | 'activity' | 'companions';

export interface EventContext {
  trigger?: string;
  mood?: string;
  location?: string;
  activity?: string;
  companions?: string;
  note?: string;
}

export interface CoachSettings {
  aiEnabled: boolean;
  /** URL des optionalen KI-Proxys. Leer = Standard aus VITE_AI_PROXY_URL bzw. /api/coach. */
  endpoint: string;
  /** Persönlicher Zugangscode für den Proxy. Liegt nur lokal auf dem Gerät. */
  accessToken: string;
}

export interface Settings {
  id: 'main';
  schemaVersion: number;
  onboarded: boolean;
  baselineCigarettesPerDay: number;
  /** Ursprüngliches Muster: Minuten zwischen Aufstehen und erster Zigarette. */
  baselineFirstCigaretteDelayMin: number;
  packPrice: number;
  cigarettesPerPack: number;
  /** HH:MM */
  usualWakeTime: string;
  /** HH:MM */
  usualSleepTime: string;
  cessationTargetMinDays: number;
  cessationTargetMaxDays: number;
  currentPlanStartDate: DayKey;
  /** Zeitpunkt des Starts. Davor wird nichts als „vermieden“ gezählt. */
  planStartedAt: number;
  appearance: Appearance;
  askDetailsAfterCigarette: boolean;
  coach: CoachSettings;
  /** Vom Nutzer selbst angelegte Auswahlwerte je Feld. */
  customOptions: Record<ContextField | 'coping', string[]>;
}

export interface CigaretteEvent extends EventContext {
  id: string;
  timestamp: number;
  createdAt: number;
  updatedAt: number;
}

export interface CravingEvent extends EventContext {
  id: string;
  startTimestamp: number;
  endTimestamp?: number;
  intensityInitial: number;
  intensityFinal?: number;
  outcome: CravingOutcome;
  copingStrategy?: string;
  relatedCigaretteEventId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Markiert einen Tag als „beobachtet“ (App geöffnet oder vom Nutzer als rauchfrei bestätigt). */
export interface DayMark {
  date: DayKey;
  source: 'opened' | 'confirmed';
}

export type PlanStep = 'start' | 'normal' | 'accelerated' | 'slowed' | 'held' | 'outlier' | 'paused';

export interface DailyPlan {
  date: DayKey;
  internalTarget: number;
  internalTargetRange: { min: number; max: number };
  /** HH:MM */
  firstCigaretteTargetStart: string;
  /** HH:MM */
  firstCigaretteTargetEnd: string;
  status: DayStatus | null;
  projectedConsumption: number;
  /** 0–1, wächst mit der Zahl auswertbarer Tage. */
  modelConfidence: number;
  generatedReasoning: {
    level: number;
    step: PlanStep;
    notes: string[];
    firstCigaretteStartDelayMin: number;
  };
}

export interface DailySummary {
  date: DayKey;
  totalCigarettes: number;
  /** HH:MM */
  firstCigaretteTime: string | null;
  cravings: number;
  cravingsPassed: number;
  avoidedCigarettes: number;
  moneySaved: number;
  status: DayStatus | null;
  /** false = keine Daten für diesen Tag, wird nicht ausgewertet. */
  observed: boolean;
}

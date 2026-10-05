import { SCHEMA_VERSION, type ContextField, type Settings } from './types';
import { dayClock, dayKeyOf } from './time';

export function defaultSettings(now: number = Date.now()): Settings {
  const usualWakeTime = '07:00';
  const usualSleepTime = '00:00';
  return {
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    onboarded: false,
    baselineCigarettesPerDay: 20,
    baselineFirstCigaretteDelayMin: 20,
    packPrice: 12,
    cigarettesPerPack: 28,
    usualWakeTime,
    usualSleepTime,
    cessationTargetMinDays: 14,
    cessationTargetMaxDays: 21,
    currentPlanStartDate: dayKeyOf(now, dayClock(usualWakeTime, usualSleepTime)),
    planStartedAt: now,
    appearance: 'system',
    askDetailsAfterCigarette: true,
    coach: { aiEnabled: false, endpoint: '', accessToken: '' },
    customOptions: { trigger: [], mood: [], location: [], activity: [], companions: [], coping: [] },
  };
}

/** Auswahl im Onboarding → typische Minuten bis zur ersten Zigarette. */
export const FIRST_CIGARETTE_CHOICES = [
  { label: 'innerhalb von 5 Minuten', delayMin: 5 },
  { label: 'innerhalb von 30 Minuten', delayMin: 20 },
  { label: 'innerhalb einer Stunde', delayMin: 45 },
  { label: 'später', delayMin: 90 },
] as const;

export const OPTIONS: Record<ContextField, string[]> = {
  trigger: [
    'Kaffee',
    'Stress',
    'Langeweile',
    'Autofahren',
    'nach dem Essen',
    'Arbeitspause',
    'Alkohol',
    'Freunde / soziale Situation',
    'Gewohnheit',
    'morgens',
    'abends',
    'sonstiges',
  ],
  mood: ['entspannt', 'neutral', 'gestresst', 'gelangweilt', 'traurig', 'gereizt', 'müde', 'gut gelaunt', 'unruhig'],
  location: ['Zuhause', 'Auto', 'Arbeit', 'draußen', 'Restaurant / Bar', 'bei Freunden', 'unterwegs'],
  companions: ['allein', 'Partner', 'Freunde', 'Kollegen', 'Familie', 'andere'],
  activity: ['Arbeiten', 'Pause', 'Essen', 'Fahren', 'Telefonieren', 'Fernsehen / Handy', 'Warten', 'Sport'],
};

export const FIELD_LABELS: Record<ContextField, string> = {
  trigger: 'Auslöser',
  mood: 'Gefühlslage',
  location: 'Ort',
  activity: 'Tätigkeit',
  companions: 'Mit wem',
};

export const COPING_STRATEGIES = [
  '2 Minuten ablenken',
  '5 Minuten überstehen',
  'Atmen',
  'Wasser trinken',
  'Kurz bewegen',
  'Etwas anderes machen',
] as const;

/** Ab dieser Stärke gilt ein Verlangen als „stark“ (Hilfe-Modus, Engine, Auswertung). */
export const STRONG_CRAVING = 7;

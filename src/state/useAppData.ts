import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Appearance, CigaretteEvent, CravingEvent, Settings } from '../domain/types';
import { buildModel, type AppModel } from '../engine/model';
import { db } from '../persistence/db';
import { markDay, saveDerived } from '../persistence/repo';

/** Aktuelle Zeit, die sich regelmäßig und beim Zurückkehren in die App aktualisiert. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [intervalMs]);
  return now;
}

export interface AppData {
  settings: Settings;
  cigarettes: CigaretteEvent[];
  cravings: CravingEvent[];
  model: AppModel;
}

/**
 * Verbindet IndexedDB (live) mit der Engine. Jede Änderung an den Rohdaten berechnet das Modell
 * neu; die abgeleiteten Tageswerte werden zusätzlich als Schnappschuss gespeichert.
 */
export function useAppData(enabled: boolean): AppData | null {
  const settings = useLiveQuery(() => (enabled ? db.settings.get('main') : undefined), [enabled]);
  const cigarettes = useLiveQuery(() => db.cigarettes.toArray(), []);
  const cravings = useLiveQuery(() => db.cravings.toArray(), []);
  const marks = useLiveQuery(() => db.dayMarks.toArray(), []);
  const liveNow = useNow();

  const model = useMemo(() => {
    if (!settings || !cigarettes || !cravings || !marks) return null;
    // Ein gerade gespeicherter Eintrag darf nie „in der Zukunft“ liegen.
    const latest = cigarettes.reduce((m, c) => Math.max(m, c.timestamp), liveNow);
    return buildModel({
      settings,
      cigarettes,
      cravings,
      observedDays: marks.map((m) => m.date),
      now: Math.max(liveNow, Math.min(latest, Date.now())),
    });
  }, [settings, cigarettes, cravings, marks, liveNow]);

  const onboarded = settings?.onboarded ?? false;
  const todayKey = model?.todayKey;
  useEffect(() => {
    if (onboarded && todayKey) void markDay(todayKey, 'opened');
  }, [onboarded, todayKey]);

  const lastSaved = useRef('');
  useEffect(() => {
    if (!model || !onboarded) return;
    const plans = model.days.map((d) => d.plan);
    const summaries = model.days.map((d) => d.summary);
    const signature = JSON.stringify([plans, summaries]);
    if (signature === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = signature;
      void saveDerived(plans, summaries);
    }, 1200);
    return () => clearTimeout(t);
  }, [model, onboarded]);

  if (!settings || !cigarettes || !cravings || !model) return null;
  return { settings, cigarettes, cravings, model };
}

const APPEARANCE_KEY = 'ausklang-appearance';

/** Setzt data-theme und die Statusleistenfarbe; merkt sich die Wahl für den nächsten Start. */
export function useAppearance(appearance: Appearance | undefined): void {
  useEffect(() => {
    if (!appearance) return;
    try {
      localStorage.setItem(APPEARANCE_KEY, appearance);
    } catch {
      // Nur eine Komfortfunktion gegen Aufblitzen beim Start.
    }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
}

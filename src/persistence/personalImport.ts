import { dayClock, dayKeyOf } from '../domain/time';
import { db } from './db';
import { loadSettings } from './repo';

interface PersonalImportPayload {
  v: 1;
  planStartedAt?: number;
  cigarettes?: number[];
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parsePayload(hash: string): PersonalImportPayload | null {
  const prefix = '#import=';
  if (!hash.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(hash.slice(prefix.length))) as PersonalImportPayload;
    if (parsed.v !== 1) return null;
    if (parsed.planStartedAt !== undefined && !Number.isFinite(parsed.planStartedAt)) return null;
    if (parsed.cigarettes && !parsed.cigarettes.every((t) => Number.isFinite(t))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Importiert persönliche historische Daten ausschließlich aus dem URL-Fragment.
 * Fragmente werden nicht an GitHub Pages übertragen. Nach erfolgreichem Import wird
 * der Fragmentteil sofort aus der Adresszeile entfernt. Der Import ist idempotent.
 */
export async function importPersonalDataFromHash(): Promise<void> {
  if (typeof window === 'undefined') return;
  const payload = parsePayload(window.location.hash);
  if (!payload) return;

  const settings = await loadSettings();
  const cigaretteTimes = [...new Set(payload.cigarettes ?? [])].sort((a, b) => a - b);

  await db.transaction('rw', db.settings, db.cigarettes, async () => {
    if (payload.planStartedAt !== undefined && payload.planStartedAt < settings.planStartedAt) {
      await db.settings.put({
        ...settings,
        planStartedAt: payload.planStartedAt,
        currentPlanStartDate: dayKeyOf(
          payload.planStartedAt,
          dayClock(settings.usualWakeTime, settings.usualSleepTime),
        ),
      });
    }

    for (const timestamp of cigaretteTimes) {
      const exists = await db.cigarettes.where('timestamp').equals(timestamp).count();
      if (exists > 0) continue;
      await db.cigarettes.add({
        id: `import-${timestamp}`,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  });

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

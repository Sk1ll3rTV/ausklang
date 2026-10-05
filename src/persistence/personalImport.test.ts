import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../domain/defaults';
import { dayClock, dayKeyOf } from '../domain/time';
import type { CigaretteEvent } from '../domain/types';
import { buildModel } from '../engine/model';
import {
  normalizedImportedCigaretteTimes,
  parsePersonalImportHash,
  settingsAfterPersonalImport,
  type PersonalImportPayload,
} from './personalImport';

const START = 1_791_135_000_000; // 2026-10-04 19:30 Europe/Berlin
const TIMES = [
  1_791_150_600_000, // 2026-10-04 23:50 Europe/Berlin
  1_791_187_980_000, // 2026-10-05 10:13 Europe/Berlin
  1_791_201_300_000, // 2026-10-05 13:55 Europe/Berlin
  1_791_207_000_000, // 2026-10-05 15:30 Europe/Berlin
];
const RECOVERY_HASH = '#import=eyJ2IjoyLCJwbGFuU3RhcnRlZEF0IjoxNzkxMTM1MDAwMDAwLCJjaWdhcmV0dGVzIjpbMTc5MTE1MDYwMDAwMCwxNzkxMTg3OTgwMDAwLDE3OTEyMDEzMDAwMDAsMTc5MTIwNzAwMDAwMF0sInNldHRpbmdzIjp7ImJhc2VsaW5lQ2lnYXJldHRlc1BlckRheSI6MjAsImJhc2VsaW5lRmlyc3RDaWdhcmV0dGVEZWxheU1pbiI6MjAsInBhY2tQcmljZSI6MTIsImNpZ2FyZXR0ZXNQZXJQYWNrIjoyOCwidXN1YWxXYWtlVGltZSI6IjA3OjAwIiwidXN1YWxTbGVlcFRpbWUiOiIwMDowMCIsImNlc3NhdGlvblRhcmdldE1pbkRheXMiOjE0LCJjZXNzYXRpb25UYXJnZXRNYXhEYXlzIjoyMX19';

function payload(): PersonalImportPayload {
  return {
    v: 2,
    planStartedAt: START,
    cigarettes: TIMES,
    settings: {
      baselineCigarettesPerDay: 20,
      baselineFirstCigaretteDelayMin: 20,
      packPrice: 12,
      cigarettesPerPack: 28,
      usualWakeTime: '07:00',
      usualSleepTime: '00:00',
      cessationTargetMinDays: 14,
      cessationTargetMaxDays: 21,
    },
  };
}

describe('personal recovery import', () => {
  it('decodes the exact recovery link to the intended personal data', () => {
    const parsed = parsePersonalImportHash(RECOVERY_HASH);
    expect(parsed).not.toBeNull();
    expect(parsed?.v).toBe(2);
    expect(parsed?.planStartedAt).toBe(START);
    expect(parsed?.cigarettes).toEqual(TIMES);
    expect(parsed?.settings).toMatchObject({
      baselineCigarettesPerDay: 20,
      baselineFirstCigaretteDelayMin: 20,
      packPrice: 12,
      cigarettesPerPack: 28,
      usualWakeTime: '07:00',
      usualSleepTime: '00:00',
      cessationTargetMinDays: 14,
      cessationTargetMaxDays: 21,
    });
  });

  it('restores onboarding state, plan start and all imported cigarette timestamps', () => {
    const current = defaultSettings(START + 99_000_000);
    const restored = settingsAfterPersonalImport(current, payload());

    expect(restored.onboarded).toBe(true);
    expect(restored.planStartedAt).toBe(START);
    expect(restored.baselineCigarettesPerDay).toBe(20);
    expect(restored.packPrice).toBe(12);
    expect(restored.cigarettesPerPack).toBe(28);
    expect(normalizedImportedCigaretteTimes(payload())).toEqual(TIMES);
  });

  it('is interpreted by the engine as one cigarette yesterday and three today', () => {
    const local = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).getTime();
    const start = local(4, 19, 30);
    const times = [local(4, 23, 50), local(5, 10, 13), local(5, 13, 55), local(5, 15, 30)];
    const localPayload: PersonalImportPayload = {
      ...payload(),
      planStartedAt: start,
      cigarettes: times,
    };
    const settings = settingsAfterPersonalImport(defaultSettings(local(5, 15, 31)), localPayload);
    const cigarettes: CigaretteEvent[] = times.map((timestamp) => ({
      id: `test-${timestamp}`,
      timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const clock = dayClock(settings.usualWakeTime, settings.usualSleepTime);
    const yesterday = dayKeyOf(local(4, 12, 0), clock);
    const today = dayKeyOf(local(5, 12, 0), clock);
    const model = buildModel({
      settings,
      cigarettes,
      cravings: [],
      observedDays: [yesterday, today],
      now: local(5, 15, 31),
    });

    const yesterdayRecord = model.days.find((d) => d.date === yesterday);
    expect(yesterdayRecord?.summary.totalCigarettes).toBe(1);
    expect(model.today.summary.totalCigarettes).toBe(3);
    expect(model.today.cigarettes.map((c) => c.timestamp)).toEqual(times.slice(1));
  });
});

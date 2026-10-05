import { useState, type ReactNode } from 'react';
import { FIRST_CIGARETTE_CHOICES } from '../../domain/defaults';
import { euro } from '../../domain/format';
import type { Settings } from '../../domain/types';
import { startPlan } from '../../persistence/repo';
import { Button } from '../components/controls';
import { Icon } from '../components/Icon';
import { MEDICAL_NOTE, Stepper, TimeInput } from './SettingsSheet';

const STEPS = 5;

export function Onboarding({ settings }: { settings: Settings }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({
    baselineCigarettesPerDay: settings.baselineCigarettesPerDay,
    baselineFirstCigaretteDelayMin: settings.baselineFirstCigaretteDelayMin,
    usualWakeTime: settings.usualWakeTime,
    usualSleepTime: settings.usualSleepTime,
    packPrice: settings.packPrice,
    cigarettesPerPack: settings.cigarettesPerPack,
  });
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  const last = step === STEPS - 1;

  return (
    <div
      className="flex h-full flex-col px-6"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 20px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
      }}
    >
      <div className="flex h-12 items-center justify-between">
        {step > 0 ? (
          <button
            type="button"
            aria-label="Zurück"
            onClick={() => setStep(step - 1)}
            className="pressable -ml-2 flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="chevronLeft" size={22} />
          </button>
        ) : (
          <span className="size-11" />
        )}
        <div className="flex gap-1.5" aria-label={`Schritt ${step + 1} von ${STEPS}`} role="img">
          {Array.from({ length: STEPS }, (_, i) => (
            <span
              key={i}
              className="h-[5px] rounded-full transition-all duration-500"
              style={{ width: i === step ? 20 : 5, background: i === step ? 'var(--ink)' : 'var(--fill2)' }}
            />
          ))}
        </div>
        <span className="size-11" />
      </div>

      <div key={step} className="fade-up scroll-area -mx-6 flex min-h-0 flex-1 flex-col justify-center px-6 pb-6">
        {step === 0 && (
          <Step title="Wie viel rauchst du normalerweise?" text="Dein Ausgangsniveau. Daran misst die App später, was du vermieden hast.">
            <Panel>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[16px] text-ink2">Zigaretten pro Tag</span>
                <Stepper
                  label="Zigaretten pro Tag"
                  value={draft.baselineCigarettesPerDay}
                  min={1}
                  max={80}
                  onChange={(v) => set({ baselineCigarettesPerDay: v })}
                />
              </div>
            </Panel>
          </Step>
        )}

        {step === 1 && (
          <Step title="Wann rauchst du morgens normalerweise die erste?" text="Gerechnet ab dem Aufstehen.">
            <div className="glass overflow-hidden rounded-[26px]" role="radiogroup" aria-label="Erste Zigarette nach dem Aufstehen">
              {FIRST_CIGARETTE_CHOICES.map((c, i) => {
                const selected = draft.baselineFirstCigaretteDelayMin === c.delayMin;
                return (
                  <button
                    key={c.delayMin}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set({ baselineFirstCigaretteDelayMin: c.delayMin })}
                    className={`flex min-h-[54px] w-full items-center justify-between px-5 text-left text-[17px] active:bg-fill ${i ? 'border-t-[0.5px] border-sep' : ''}`}
                  >
                    {c.label}
                    {selected && (
                      <span className="text-accent">
                        <Icon name="check" size={20} strokeWidth={2.2} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step title="Wann schläfst du ungefähr?" text="Nachts läuft kein Zähler weiter. Ungefähre Zeiten genügen.">
            <Panel>
              <div className="flex min-h-[48px] items-center justify-between">
                <span className="text-[16px]">Schlafen gehen</span>
                <TimeInput label="Schlafen gehen" value={draft.usualSleepTime} onChange={(v) => set({ usualSleepTime: v })} />
              </div>
              <div className="mt-1 flex min-h-[48px] items-center justify-between border-t-[0.5px] border-sep pt-1">
                <span className="text-[16px]">Aufstehen</span>
                <TimeInput label="Aufstehen" value={draft.usualWakeTime} onChange={(v) => set({ usualWakeTime: v })} />
              </div>
            </Panel>
          </Step>
        )}

        {step === 3 && (
          <Step title="Packung" text={`Das sind ${euro(draft.packPrice / draft.cigarettesPerPack)} pro Zigarette.`}>
            <Panel>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[16px]">Preis</span>
                <Stepper
                  label="Packungspreis"
                  value={draft.packPrice}
                  min={1}
                  max={60}
                  step={0.5}
                  format={euro}
                  onChange={(v) => set({ packPrice: v })}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 border-t-[0.5px] border-sep pt-1">
                <span className="text-[16px]">Zigaretten</span>
                <Stepper
                  label="Zigaretten pro Packung"
                  value={draft.cigarettesPerPack}
                  min={1}
                  max={60}
                  onChange={(v) => set({ cigarettesPerPack: v })}
                />
              </div>
            </Panel>
          </Step>
        )}

        {step === 4 && (
          <Step
            title="Langsam auf 0"
            text="Die App passt deinen Reduktionspfad automatisch an. Zielbereich: ungefähr 2–3 Wochen. Wenn es schneller gut funktioniert, kann der Plan früher bei 0 ankommen."
          >
            <p className="px-1 text-[13px] leading-snug text-ink3">{MEDICAL_NOTE}</p>
          </Step>
        )}
      </div>

      <Button variant="solid" className="min-h-[56px]" onClick={() => (last ? void startPlan(draft) : setStep(step + 1))}>
        {last ? 'Starten' : 'Weiter'}
      </Button>
    </div>
  );
}

function Step({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="text-[32px] font-bold leading-[1.12] tracking-tight">{title}</h1>
      <p className="mt-3 text-[17px] leading-snug text-ink2">{text}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="glass rounded-[26px] px-5 py-3">{children}</div>;
}

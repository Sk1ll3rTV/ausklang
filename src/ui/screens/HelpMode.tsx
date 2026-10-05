import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CopingStat } from '../../analytics/stats';
import type { CravingEvent } from '../../domain/types';
import { addCigarette, resolveCraving } from '../../persistence/repo';
import { Button, IntensityScale } from '../components/controls';
import { Icon, type IconName } from '../components/Icon';

interface Option {
  strategy: string;
  icon: IconName;
  /** Ruhiger Begleittext während der Übung. */
  prompt: string;
  seconds: number;
  breathing?: boolean;
}

const OPTIONS: Option[] = [
  { strategy: '2 Minuten ablenken', icon: 'shuffle', prompt: 'Richte deine Aufmerksamkeit zwei Minuten auf etwas anderes.', seconds: 120 },
  { strategy: '5 Minuten überstehen', icon: 'clock', prompt: 'Es reicht, fünf Minuten nichts zu entscheiden.', seconds: 300 },
  { strategy: 'Atmen', icon: 'wind', prompt: '', seconds: 90, breathing: true },
  { strategy: 'Wasser trinken', icon: 'drop', prompt: 'Hol dir ein Glas Wasser und trink es langsam.', seconds: 75 },
  { strategy: 'Kurz bewegen', icon: 'walk', prompt: 'Steh auf, geh ein paar Schritte, streck dich.', seconds: 90 },
  { strategy: 'Etwas anderes machen', icon: 'spark', prompt: 'Wechsle kurz den Ort oder die Tätigkeit.', seconds: 90 },
];

type Stage = { name: 'menu'; again?: boolean } | { name: 'activity'; option: Option } | { name: 'check'; option: Option };

/**
 * Akuthilfe bei starkem Verlangen. Bewusst karg: eine Auswahl, eine ruhige Fläche, eine Nachfrage.
 * Kein Herunterzählen – die Zeit läuft unsichtbar.
 */
export function HelpMode({
  craving,
  personal,
  onClose,
}: {
  craving: CravingEvent | null;
  /** Strategie, die dem Nutzer schon öfter geholfen hat. */
  personal: CopingStat | null;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'menu' });
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    if (craving) {
      setStage({ name: 'menu' });
      setLevel(null);
    }
  }, [craving?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage.name !== 'activity') return;
    const option = stage.option;
    const t = setTimeout(() => setStage({ name: 'check', option }), option.seconds * 1000);
    return () => clearTimeout(t);
  }, [stage]);

  if (!craving) return null;

  const options: Option[] =
    personal && !OPTIONS.some((o) => o.strategy === personal.strategy)
      ? [{ strategy: personal.strategy, icon: 'spark', prompt: 'Das hat dir schon geholfen.', seconds: 90 }, ...OPTIONS]
      : personal
        ? [...OPTIONS].sort((a, b) => Number(b.strategy === personal.strategy) - Number(a.strategy === personal.strategy))
        : OPTIONS;

  const finish = async (outcome: 'passed' | 'smoked', option: Option) => {
    const extra = { copingStrategy: option.strategy, ...(level !== null ? { intensityFinal: level } : {}) };
    if (outcome === 'smoked') {
      const cig = await addCigarette(Date.now(), {
        trigger: craving.trigger,
        mood: craving.mood,
        location: craving.location,
        activity: craving.activity,
        companions: craving.companions,
      });
      await resolveCraving(craving.id, 'smoked', { ...extra, relatedCigaretteEventId: cig.id });
    } else {
      await resolveCraving(craving.id, 'passed', extra);
    }
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hilfe bei Verlangen"
      className="fade-in fixed inset-0 z-[60] flex flex-col bg-bg"
      style={{
        backgroundImage: 'var(--ambient)',
        paddingTop: 'max(env(safe-area-inset-top), 20px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
      }}
    >
      <div className="flex justify-end px-4">
        <button
          type="button"
          aria-label="Schließen"
          onClick={onClose}
          className="pressable glass flex size-11 items-center justify-center rounded-full text-ink2"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      {stage.name === 'menu' && (
        <div key="menu" className="fade-up scroll-area flex min-h-0 flex-1 flex-col px-5">
          <div className="pb-6 pt-6">
            <h2 className="text-[30px] font-bold leading-tight">
              {stage.again ? 'Okay. Etwas anderes?' : 'Das geht vorbei.'}
            </h2>
            <p className="mt-2 text-[17px] text-ink2">Such dir eine Sache aus. Mehr braucht es nicht.</p>
          </div>
          <ul className="glass overflow-hidden rounded-[26px]">
            {options.map((o, i) => (
              <li key={o.strategy} className={i ? 'border-t-[0.5px] border-sep' : ''}>
                <button
                  type="button"
                  onClick={() => setStage({ name: 'activity', option: o })}
                  className="flex min-h-[60px] w-full items-center gap-3.5 px-4 text-left active:bg-fill"
                >
                  <span className="text-accent">
                    <Icon name={o.icon} size={22} />
                  </span>
                  <span className="flex-1">
                    <span className="block text-[17px]">{o.strategy}</span>
                    {personal?.strategy === o.strategy && (
                      <span className="block text-[13px] text-ink2">
                        Hat dir {personal.worked} von {personal.tried} Mal geholfen
                      </span>
                    )}
                  </span>
                  <span className="text-ink3">
                    <Icon name="chevronRight" size={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage.name === 'activity' && (
        <div key="activity" className="fade-in flex min-h-0 flex-1 flex-col items-center px-6">
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="relative flex size-[230px] items-center justify-center">
              <div
                className={`absolute inset-0 rounded-full ${stage.option.breathing ? 'breathe' : 'drift'}`}
                style={{
                  background:
                    'radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 34%, transparent), color-mix(in srgb, var(--accent) 12%, transparent) 70%)',
                  border: '0.5px solid var(--glass-border)',
                }}
              />
              {stage.option.breathing && <BreathLabel />}
            </div>
            <p className="mt-10 max-w-[26ch] text-center text-[20px] font-medium leading-snug">
              {stage.option.breathing ? 'Folge dem Kreis.' : stage.option.prompt}
            </p>
          </div>
          <div className="w-full pb-2">
            <Button variant="glass" onClick={() => setStage({ name: 'check', option: stage.option })}>
              Weiter
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'check' && (
        <div key="check" className="fade-up scroll-area flex min-h-0 flex-1 flex-col px-5">
          <div className="pb-5 pt-6">
            <h2 className="text-[30px] font-bold leading-tight">Wie ist es jetzt?</h2>
            <p className="mt-2 text-[17px] text-ink2">Zu Beginn: Stärke {craving.intensityInitial}/10</p>
          </div>
          <IntensityScale value={level} onChange={setLevel} />
          <div className="mt-auto space-y-2.5 pb-2 pt-8">
            <Button variant="solid" onClick={() => void finish('passed', stage.option)}>
              Vorbei
            </Button>
            <Button variant="glass" onClick={() => setStage({ name: 'menu', again: true })}>
              Noch da
            </Button>
            <Button variant="plain" className="text-ink2" onClick={() => void finish('smoked', stage.option)}>
              Ich habe geraucht
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Wechselt im Takt der Atemanimation (10 s pro Zyklus) zwischen Ein- und Ausatmen. */
function BreathLabel() {
  const [inhale, setInhale] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const cycle = (next: boolean) => {
      setInhale(next);
      timer = setTimeout(() => cycle(!next), 5000);
    };
    cycle(true);
    return () => clearTimeout(timer);
  }, []);
  return <span className="relative text-[18px] font-medium text-ink2">{inhale ? 'Einatmen' : 'Ausatmen'}</span>;
}

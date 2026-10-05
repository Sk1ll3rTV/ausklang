import { useEffect, useState } from 'react';
import { COPING_STRATEGIES, STRONG_CRAVING } from '../../domain/defaults';
import { formatTime } from '../../domain/time';
import type { CigaretteEvent, CravingEvent, EventContext, Settings } from '../../domain/types';
import {
  addCraving,
  deleteCigarette,
  rememberCustomOption,
  resolveCraving,
  updateCigarette,
  updateCraving,
} from '../../persistence/repo';
import { Button, Chip, ChipSelect, ContextFields, IntensityScale } from '../components/controls';
import { Sheet, SheetAction, useLatched } from '../components/Sheet';

const pickContext = (e: EventContext): EventContext => ({
  trigger: e.trigger,
  mood: e.mood,
  location: e.location,
  activity: e.activity,
  companions: e.companions,
});

/** Nach dem Eintragen: alles optional, „Überspringen“ ändert nichts. */
export function CigaretteDetailsSheet({
  event,
  relatedCraving,
  settings,
  onClose,
}: {
  event: CigaretteEvent | null;
  /** Kürzliches Verlangen, zu dem die Zigarette gehören könnte. */
  relatedCraving: CravingEvent | null;
  settings: Settings;
  onClose: () => void;
}) {
  const current = useLatched(event);
  const craving = useLatched(event ? relatedCraving : undefined);
  const [ctx, setCtx] = useState<EventContext>({});
  const [belongs, setBelongs] = useState<boolean | null>(null);

  useEffect(() => {
    if (!event) return;
    // Kontext des Verlangens als Vorschlag übernehmen – spart Tipparbeit.
    setCtx(relatedCraving ? pickContext(relatedCraving) : {});
    setBelongs(null);
  }, [event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (current) {
      await updateCigarette(current.id, ctx);
      if (craving && belongs) {
        await resolveCraving(craving.id, 'smoked', {
          endTimestamp: current.timestamp,
          relatedCigaretteEventId: current.id,
        });
      }
    }
    onClose();
  };

  const undo = async () => {
    if (current) await deleteCigarette(current.id);
    onClose();
  };

  const showCraving = craving && relatedCraving;
  return (
    <Sheet
      open={event !== null}
      onClose={onClose}
      title="Eingetragen"
      leading={<SheetAction onClick={onClose}>Überspringen</SheetAction>}
      trailing={
        <SheetAction strong onClick={() => void save()}>
          Fertig
        </SheetAction>
      }
    >
      <p className="pb-4 pt-1 text-center text-[15px] text-ink2">
        {current ? `${formatTime(current.timestamp)} Uhr · ` : ''}Möchtest du etwas ergänzen?
      </p>

      {showCraving && (
        <div className="mb-4 rounded-[22px] bg-fill p-4">
          <p className="text-[16px]">Gehörte diese Zigarette zum vorherigen Verlangen?</p>
          <p className="mt-0.5 text-[14px] text-ink2">
            {formatTime(craving.startTimestamp)} Uhr · Stärke {craving.intensityInitial}/10
          </p>
          <div className="mt-3 flex gap-2">
            <Chip selected={belongs === true} onClick={() => setBelongs(belongs === true ? null : true)}>
              Ja
            </Chip>
            <Chip selected={belongs === false} onClick={() => setBelongs(belongs === false ? null : false)}>
              Nein
            </Chip>
          </div>
        </div>
      )}

      <ContextFields value={ctx} onChange={setCtx} settings={settings} />

      <button type="button" onClick={() => void undo()} className="mx-auto mt-4 block min-h-[44px] px-4 text-[15px] text-ink2">
        Eintrag rückgängig machen
      </button>
    </Sheet>
  );
}

/** Verlangen eintragen: zuerst die Stärke, alles Weitere optional. */
export function CravingSheet({
  open,
  settings,
  onClose,
  onHelp,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onHelp: (craving: CravingEvent) => void;
}) {
  const [intensity, setIntensity] = useState<number | null>(null);
  const [ctx, setCtx] = useState<EventContext>({});
  const [saved, setSaved] = useState<CravingEvent | null>(null);

  useEffect(() => {
    if (open) {
      setIntensity(null);
      setCtx({});
      setSaved(null);
    }
  }, [open]);

  const save = async () => {
    if (intensity === null) return;
    const craving = await addCraving(intensity, ctx);
    if (intensity >= STRONG_CRAVING) setSaved(craving);
    else onClose();
  };

  if (saved) {
    return (
      <Sheet open={open} onClose={onClose} title="Eingetragen">
        <div className="fade-in pb-2 pt-2 text-center">
          <p className="mx-auto max-w-[28ch] text-[16px] leading-snug text-ink2">
            Starke Verlangen klingen meist nach wenigen Minuten wieder ab.
          </p>
          <div className="mt-6 space-y-2.5">
            <Button
              variant="solid"
              onClick={() => {
                onClose();
                onHelp(saved);
              }}
            >
              Hilf mir kurz
            </Button>
            <Button variant="tinted" onClick={onClose}>
              Schließen
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Verlangen"
      leading={<SheetAction onClick={onClose}>Abbrechen</SheetAction>}
      trailing={
        <SheetAction strong disabled={intensity === null} onClick={() => void save()}>
          Sichern
        </SheetAction>
      }
    >
      <p className="pb-3 pt-2 text-[20px] font-semibold">Wie stark?</p>
      <IntensityScale value={intensity} onChange={setIntensity} />
      <div className="flex justify-between px-1 pt-2 text-[12px] text-ink3">
        <span>kaum</span>
        <span>sehr stark</span>
      </div>

      <p className="pb-2 pt-6 text-[13px] font-medium uppercase tracking-wide text-ink2">Optional</p>
      <ContextFields value={ctx} onChange={setCtx} settings={settings} />

      <div className="pt-5">
        <Button variant="solid" disabled={intensity === null} onClick={() => void save()}>
          Sichern
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Erscheint, nachdem „Verlangen vorbei“ getippt wurde. Das Verlangen ist zu diesem Zeitpunkt
 * bereits als überstanden gespeichert – hier lässt sich nur noch ergänzen, was geholfen hat.
 */
export function CravingDoneSheet({
  craving,
  settings,
  onClose,
}: {
  craving: CravingEvent | null;
  settings: Settings;
  onClose: () => void;
}) {
  const current = useLatched(craving);
  const [final, setFinal] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<string | undefined>();

  useEffect(() => {
    if (craving) {
      setFinal(null);
      setStrategy(craving.copingStrategy);
    }
  }, [craving?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (current) {
      await updateCraving(current.id, {
        ...(final !== null ? { intensityFinal: final } : {}),
        ...(strategy ? { copingStrategy: strategy } : {}),
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={craving !== null}
      onClose={onClose}
      title="Überstanden"
      leading={<SheetAction onClick={onClose}>Überspringen</SheetAction>}
      trailing={
        <SheetAction strong onClick={() => void save()}>
          Fertig
        </SheetAction>
      }
    >
      <p className="pb-4 pt-1 text-center text-[15px] text-ink2">Ohne Zigarette vorbeigegangen.</p>
      <p className="pb-2 text-[16px] font-semibold">Was hat geholfen?</p>
      <ChipSelect
        options={[...COPING_STRATEGIES, 'Einfach abgewartet', ...(settings.customOptions.coping ?? [])]}
        value={strategy}
        onChange={setStrategy}
        onAddCustom={(v) => void rememberCustomOption('coping', v)}
        customLabel="Eigener Trick"
      />
      <p className="pb-2 pt-6 text-[16px] font-semibold">Wie stark ist es jetzt?</p>
      <IntensityScale value={final} onChange={setFinal} />
    </Sheet>
  );
}

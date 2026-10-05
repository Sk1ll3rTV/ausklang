import { useEffect, useRef, useState } from 'react';
import { STRONG_CRAVING } from '../../domain/defaults';
import { duration, euro, num } from '../../domain/format';
import { HOUR, formatTime } from '../../domain/time';
import type { CravingEvent, DayStatus } from '../../domain/types';
import type { AppModel } from '../../engine/model';
import { Button, Card, StatusBadge } from '../components/controls';
import { Icon } from '../components/Icon';

const STATUS_TEXT: Record<DayStatus, string> = {
  green: 'Du liegst in deinem aktuellen Bereich.',
  orange: 'Eine normale Abweichung – kein Grund, etwas zu ändern.',
  red: 'Heute liegt dein Konsum über deinem aktuellen Bereich. Morgen wird nicht automatisch härter.',
};

interface Props {
  model: AppModel;
  onCravingPassed: (craving: CravingEvent) => void;
  onHelp: (craving: CravingEvent) => void;
}

export function TodayScreen({ model, onCravingPassed, onHelp }: Props) {
  const count = model.today.cigarettes.length;
  const status = model.today.plan.status ?? 'green';
  const fc = model.firstCigarette;

  // Kurzes visuelles Feedback, wenn sich die Zahl ändert.
  const [bump, setBump] = useState(0);
  const previous = useRef(count);
  useEffect(() => {
    if (previous.current !== count) {
      previous.current = count;
      setBump((b) => b + 1);
    }
  }, [count]);

  return (
    <div className="space-y-3 pb-2">
      <section className="px-1 pb-3 pt-2" aria-live="polite">
        <div className="flex items-baseline gap-3">
          <span key={bump} className={`num text-[92px] font-bold leading-[0.95] ${bump ? 'bump' : ''} inline-block origin-left`}>
            {num(count)}
          </span>
          <span className="text-[22px] font-medium text-ink2">{count === 1 ? 'Zigarette' : 'Zigaretten'}</span>
        </div>
        <div className="mt-4">
          <StatusBadge status={status} />
        </div>
        <p className="mt-2.5 max-w-[34ch] text-[15px] leading-snug text-ink2">
          {status === 'green' && count === 0 ? 'Bisher keine Zigarette heute.' : STATUS_TEXT[status]}
        </p>
      </section>

      {model.activeCravings.map((c) => (
        <ActiveCraving key={c.id} craving={c} now={model.now} onPassed={onCravingPassed} onHelp={onHelp} />
      ))}

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[13px] font-medium text-ink2">Seit Start vermieden</p>
          <p className="num mt-1 text-[32px] font-semibold leading-none">{num(model.totals.avoided)}</p>
          <p className="mt-1 text-[14px] text-ink2">{model.totals.avoided === 1 ? 'Zigarette' : 'Zigaretten'}</p>
        </Card>
        <Card>
          <p className="text-[13px] font-medium text-ink2">Geschätzt gespart</p>
          <p className="num mt-1 text-[32px] font-semibold leading-none">{euro(model.totals.moneySaved)}</p>
          <p className="mt-1 text-[14px] text-ink2">gegenüber vorher</p>
        </Card>
      </div>

      {fc.relevant && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink2">Erste Zigarette</p>
              {fc.actualTs === null ? (
                <>
                  <p className="num mt-1 text-[28px] font-semibold leading-tight">
                    {fc.targetStart}–{fc.targetEnd}
                  </p>
                  <p className="mt-0.5 text-[14px] text-ink2">Guter Bereich heute</p>
                </>
              ) : (
                <>
                  <p className="num mt-1 text-[28px] font-semibold leading-tight">{formatTime(fc.actualTs)}</p>
                  <p className="mt-0.5 text-[14px] text-ink2">
                    {fc.laterThanAverageMin !== null
                      ? `${duration(fc.laterThanAverageMin)} später als dein 7-Tage-Schnitt`
                      : fc.laterThanBaselineMin !== null
                        ? `+${duration(fc.laterThanBaselineMin)} gegenüber deinem ursprünglichen Muster`
                        : 'Erste Zigarette heute'}
                  </p>
                </>
              )}
            </div>
            <span className="mt-0.5 text-ink3">
              <Icon name="clock" size={22} />
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function ActiveCraving({
  craving,
  now,
  onPassed,
  onHelp,
}: {
  craving: CravingEvent;
  now: number;
  onPassed: (c: CravingEvent) => void;
  onHelp: (c: CravingEvent) => void;
}) {
  const old = now - craving.startTimestamp > 3 * HOUR;
  return (
    <Card className="fade-up">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-accent">
          <Icon name="wave" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold">{old ? 'Verlangen noch offen?' : 'Verlangen läuft'}</p>
          <p className="truncate text-[14px] text-ink2">
            seit {formatTime(craving.startTimestamp)} · Stärke {craving.intensityInitial}/10
            {craving.trigger ? ` · ${craving.trigger}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="tinted" className="min-h-[46px] text-[16px]" onClick={() => onPassed(craving)}>
          Verlangen vorbei
        </Button>
        {craving.intensityInitial >= STRONG_CRAVING && (
          <Button variant="tinted" className="min-h-[46px] text-[16px] text-accent" onClick={() => onHelp(craving)}>
            Hilf mir kurz
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Die beiden Hauptaktionen – fest über der Navigation, immer mit dem Daumen erreichbar. */
export function TodayDock({ onCigarette, onCraving }: { onCigarette: () => void; onCraving: () => void }) {
  const [pulse, setPulse] = useState(0);
  return (
    <div className="space-y-2.5">
      <div className="relative">
        {pulse > 0 && (
          <span
            key={pulse}
            aria-hidden="true"
            className="pulse-ring pointer-events-none absolute inset-0 rounded-full border-2 border-[var(--solid)]"
          />
        )}
        <Button
          variant="solid"
          className="min-h-[62px] text-[19px]"
          onClick={() => {
            setPulse((p) => p + 1);
            onCigarette();
          }}
        >
          <Icon name="plus" size={20} strokeWidth={2.2} />
          Zigarette
        </Button>
      </div>
      <Button variant="glass" className="min-h-[52px]" onClick={onCraving}>
        Ich habe Verlangen
      </Button>
    </div>
  );
}

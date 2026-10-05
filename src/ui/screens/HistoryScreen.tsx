import { useEffect, useMemo, useState } from 'react';
import { COPING_STRATEGIES } from '../../domain/defaults';
import { STATUS_LABEL_PAST, dayLabel, euro, num } from '../../domain/format';
import { MIN, formatTime, parseDayKey, toDayKey } from '../../domain/time';
import type { CigaretteEvent, CravingEvent, CravingOutcome, DayKey, EventContext, Settings } from '../../domain/types';
import type { AppModel, DayRecord } from '../../engine/model';
import {
  addCigarette,
  addCraving,
  deleteCigarette,
  deleteCraving,
  markDay,
  restoreCigarette,
  restoreCraving,
  updateCigarette,
  updateCraving,
} from '../../persistence/repo';
import {
  Button,
  Card,
  ChipSelect,
  ContextFields,
  IntensityScale,
  SectionLabel,
  Segmented,
  StatusDot,
} from '../components/controls';
import { Icon } from '../components/Icon';
import { Sheet, SheetAction, useLatched } from '../components/Sheet';

export type Notify = (text: string, undo?: () => void) => void;

interface Props {
  model: AppModel;
  settings: Settings;
  notify: Notify;
}

type Editing =
  | { kind: 'cigarette'; date: DayKey; event: CigaretteEvent | null }
  | { kind: 'craving'; date: DayKey; event: CravingEvent | null };

export function HistoryScreen({ model, settings, notify }: Props) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [openDate, setOpenDate] = useState<DayKey | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const byDate = useMemo(() => new Map(model.days.map((d) => [d.date, d])), [model.days]);
  const openDay = openDate ? (byDate.get(openDate) ?? null) : null;

  return (
    <div className="space-y-4">
      <Segmented
        label="Ansicht"
        value={view}
        onChange={setView}
        options={[
          { value: 'calendar', label: 'Kalender' },
          { value: 'list', label: 'Liste' },
        ]}
      />
      {view === 'calendar' ? (
        <Calendar model={model} byDate={byDate} onOpen={setOpenDate} />
      ) : (
        <DayList days={model.days} onOpen={setOpenDate} />
      )}

      <DayDetailSheet
        day={openDay}
        settings={settings}
        onClose={() => setOpenDate(null)}
        onEdit={setEditing}
        notify={notify}
      />
      <EventEditSheet
        editing={editing}
        day={editing ? (byDate.get(editing.date) ?? null) : null}
        now={model.now}
        settings={settings}
        onClose={() => setEditing(null)}
        notify={notify}
      />
    </div>
  );
}

// --- Kalender ---------------------------------------------------------------------

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function Calendar({
  model,
  byDate,
  onOpen,
}: {
  model: AppModel;
  byDate: Map<DayKey, DayRecord>;
  onOpen: (d: DayKey) => void;
}) {
  const today = parseDayKey(model.todayKey);
  const first = parseDayKey(model.days[0].date);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const canPrev = month > new Date(first.getFullYear(), first.getMonth(), 1);
  const canNext = month < new Date(today.getFullYear(), today.getMonth(), 1);
  const leading = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (DayKey | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDayKey(new Date(month.getFullYear(), month.getMonth(), i + 1))),
  ];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <Card className="px-3">
      <div className="flex items-center justify-between pb-2">
        <NavButton label="Vorheriger Monat" icon="chevronLeft" disabled={!canPrev} onClick={() => shift(-1)} />
        <p className="text-[17px] font-semibold">
          {month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </p>
        <NavButton label="Nächster Monat" icon="chevronRight" disabled={!canNext} onClick={() => shift(1)} />
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] font-medium text-ink3">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((key, i) => {
          if (!key) return <span key={`e${i}`} />;
          const day = byDate.get(key);
          const dayNumber = Number(key.slice(8));
          if (!day) {
            return (
              <span key={key} className="flex h-[66px] flex-col items-center pt-2 text-[15px] leading-none text-ink3">
                {dayNumber}
              </span>
            );
          }
          const s = day.summary;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpen(key)}
              aria-label={`${dayLabel(key)}: ${
                s.observed
                  ? `${s.totalCigarettes} Zigaretten${s.status ? `, ${STATUS_LABEL_PAST[s.status]}` : ''}`
                  : 'keine Einträge'
              }`}
              className={`pressable flex h-[66px] flex-col items-center rounded-2xl pt-2 ${day.isToday ? 'bg-fill' : ''}`}
            >
              <span className={`text-[15px] leading-none ${day.isToday ? 'font-semibold text-accent' : ''}`}>{dayNumber}</span>
              <span className="num mt-2 text-[16px] font-semibold leading-none">
                {s.observed ? s.totalCigarettes : '–'}
              </span>
              <span className="mt-1.5 flex">
                <StatusDot status={s.status} size={6} />
              </span>
            </button>
          );
        })}
      </div>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t-[0.5px] border-sep pt-3 text-[12px] text-ink2">
        {(['green', 'orange', 'red'] as const).map((st) => (
          <li key={st} className="flex items-center gap-1.5">
            <StatusDot status={st} size={7} />
            {STATUS_LABEL_PAST[st]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NavButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'chevronLeft' | 'chevronRight';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable flex size-11 items-center justify-center rounded-full text-accent disabled:text-ink3 disabled:opacity-50"
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

// --- Liste -------------------------------------------------------------------------

function DayList({ days, onOpen }: { days: DayRecord[]; onOpen: (d: DayKey) => void }) {
  return (
    <ul className="glass overflow-hidden rounded-[26px]">
      {[...days].reverse().map((day, i) => {
        const s = day.summary;
        return (
          <li key={day.date} className={i ? 'border-t-[0.5px] border-sep' : ''}>
            <button
              type="button"
              onClick={() => onOpen(day.date)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-fill"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold">{day.isToday ? 'Heute' : dayLabel(day.date)}</p>
                {s.observed ? (
                  <>
                    <p className="mt-1 flex items-center gap-1.5 text-[14px] text-ink2">
                      <StatusDot status={s.status} size={8} />
                      <span className="truncate">
                        {s.status ? STATUS_LABEL_PAST[s.status] : 'Angebrochener Starttag'}
                        {s.firstCigaretteTime ? ` · Erste ${s.firstCigaretteTime}` : ''}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-ink3">
                      {s.cravings > 0 ? `Verlangen ${s.cravingsPassed}/${s.cravings} überstanden · ` : ''}
                      {num(s.avoidedCigarettes)} vermieden · {euro(s.moneySaved)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[14px] text-ink3">Keine Einträge – nicht ausgewertet</p>
                )}
              </div>
              <div className="text-right">
                <p className="num text-[26px] font-semibold leading-none">{s.observed ? s.totalCigarettes : '–'}</p>
              </div>
              <span className="text-ink3">
                <Icon name="chevronRight" size={16} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// --- Tagesdetail -------------------------------------------------------------------

type TimelineItem = {
  ts: number;
  key: string;
  title: string;
  detail?: string;
  icon: 'cigarette' | 'wave' | 'check' | 'clock';
  onTap?: () => void;
};

function contextLine(e: EventContext): string {
  return [e.trigger, e.mood, e.location, e.companions, e.activity].filter(Boolean).join(' · ');
}

function buildTimeline(day: DayRecord, onEdit: (e: Editing) => void): TimelineItem[] {
  const items: TimelineItem[] = [{ ts: day.wakeTs, key: 'wake', title: 'Aufgestanden', icon: 'clock' }];
  for (const c of day.cigarettes) {
    items.push({
      ts: c.timestamp,
      key: c.id,
      title: 'Zigarette',
      detail: contextLine(c),
      icon: 'cigarette',
      onTap: () => onEdit({ kind: 'cigarette', date: day.date, event: c }),
    });
  }
  for (const c of day.cravings) {
    const edit = () => onEdit({ kind: 'craving', date: day.date, event: c });
    items.push({
      ts: c.startTimestamp,
      key: c.id,
      title: `Verlangen ${c.intensityInitial}/10`,
      detail: contextLine(c),
      icon: 'wave',
      onTap: edit,
    });
    if (c.outcome === 'passed' && c.endTimestamp) {
      items.push({
        ts: c.endTimestamp,
        key: `${c.id}-end`,
        title: 'Verlangen vorbei',
        detail: c.copingStrategy,
        icon: 'check',
        onTap: edit,
      });
    }
  }
  return items.sort((a, b) => a.ts - b.ts);
}

function DayDetailSheet({
  day,
  settings,
  onClose,
  onEdit,
  notify,
}: {
  day: DayRecord | null;
  settings: Settings;
  onClose: () => void;
  onEdit: (e: Editing) => void;
  notify: Notify;
}) {
  const d = useLatched(day);
  if (!d) return null;
  const s = d.summary;
  const timeline = buildTimeline(d, onEdit);

  return (
    <Sheet
      open={day !== null}
      onClose={onClose}
      tall
      title={d.isToday ? 'Heute' : dayLabel(d.date)}
      trailing={
        <SheetAction strong onClick={onClose}>
          Fertig
        </SheetAction>
      }
    >
      {s.observed ? (
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Stat label="Zigaretten" value={num(s.totalCigarettes)} />
          <Stat label="Erste" value={s.firstCigaretteTime ?? '–'} />
          <Stat label="Verlangen" value={s.cravings ? `${s.cravingsPassed}/${s.cravings}` : '0'} hint={s.cravings ? 'überstanden' : undefined} />
          <Stat label="Vermieden" value={num(s.avoidedCigarettes)} />
          <Stat label="Gespart" value={euro(s.moneySaved)} />
          <div className="rounded-[18px] bg-fill px-3 py-2.5">
            <p className="text-[12px] text-ink2">Status</p>
            <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold leading-tight">
              <StatusDot status={s.status} size={9} />
              {s.status ? STATUS_LABEL_PAST[s.status].replace(' dem Bereich', '') : 'offen'}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-[22px] bg-fill p-4">
          <p className="text-[16px] font-semibold">Keine Einträge an diesem Tag</p>
          <p className="mt-1 text-[14px] leading-snug text-ink2">
            Der Tag fließt deshalb nicht in die Auswertung ein. Wenn du an diesem Tag nicht geraucht hast, kannst du
            das bestätigen.
          </p>
          <Button
            className="mt-3 min-h-[46px] text-[16px]"
            variant="glass"
            onClick={() => {
              void markDay(d.date, 'confirmed');
              notify('Als rauchfreier Tag gespeichert');
            }}
          >
            Tag war rauchfrei
          </Button>
        </div>
      )}

      <div className="pt-6">
        <SectionLabel>Verlauf</SectionLabel>
        <ol className="overflow-hidden rounded-[22px] bg-fill">
          {timeline.map((item, i) => {
            const body = (
              <>
                <span className="num w-[46px] shrink-0 text-[15px] text-ink2">{formatTime(item.ts)}</span>
                <span className="text-ink3">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px]">{item.title}</span>
                  {item.detail && <span className="block truncate text-[13px] text-ink2">{item.detail}</span>}
                </span>
                {item.onTap && (
                  <span className="text-ink3">
                    <Icon name="chevronRight" size={15} />
                  </span>
                )}
              </>
            );
            return (
              <li key={item.key} className={i ? 'border-t-[0.5px] border-sep' : ''}>
                {item.onTap ? (
                  <button
                    type="button"
                    onClick={item.onTap}
                    className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-fill"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
        {timeline.length === 1 && (
          <p className="px-1 pt-2 text-[13px] text-ink3">
            Aufstehzeit laut Einstellungen ({settings.usualWakeTime} Uhr). Noch keine Einträge.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-4">
        <Button className="min-h-[46px] text-[15px]" onClick={() => onEdit({ kind: 'cigarette', date: d.date, event: null })}>
          <Icon name="plus" size={16} />
          Zigarette
        </Button>
        <Button className="min-h-[46px] text-[15px]" onClick={() => onEdit({ kind: 'craving', date: d.date, event: null })}>
          <Icon name="plus" size={16} />
          Verlangen
        </Button>
      </div>
      <p className="px-1 pt-2 text-[13px] text-ink3">Einträge antippen, um sie zu bearbeiten oder zu löschen.</p>
    </Sheet>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[18px] bg-fill px-3 py-2.5">
      <p className="text-[12px] text-ink2">{label}</p>
      <p className="num mt-0.5 text-[20px] font-semibold leading-tight">{value}</p>
      {hint && <p className="text-[11px] text-ink3">{hint}</p>}
    </div>
  );
}

// --- Bearbeiten ---------------------------------------------------------------------

/** Uhrzeit → Zeitstempel innerhalb des logischen Tages (der über Mitternacht reichen kann). */
function timestampInDay(day: DayRecord, hm: string): number {
  const base = parseDayKey(day.date);
  const [h, m] = hm.split(':').map(Number);
  for (const offset of [0, 1, -1]) {
    const ts = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, h || 0, m || 0).getTime();
    if (ts >= day.startTs && ts < day.endTs) return ts;
  }
  return day.wakeTs;
}

interface Draft {
  time: string;
  ctx: EventContext;
  intensity: number;
  outcome: CravingOutcome;
  endTime: string;
  final: number | null;
  strategy?: string;
}

function EventEditSheet({
  editing,
  day,
  now,
  settings,
  onClose,
  notify,
}: {
  editing: Editing | null;
  day: DayRecord | null;
  now: number;
  settings: Settings;
  onClose: () => void;
  notify: Notify;
}) {
  const e = useLatched(editing);
  const d = useLatched(day);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!editing || !day) return;
    const fallback = day.isToday ? now : Math.min(day.wakeTs + 5 * 60 * MIN, now);
    const ev = editing.event;
    const start = ev ? ('timestamp' in ev ? ev.timestamp : ev.startTimestamp) : fallback;
    const craving = editing.kind === 'craving' ? editing.event : null;
    setDraft({
      time: formatTime(start),
      ctx: ev
        ? { trigger: ev.trigger, mood: ev.mood, location: ev.location, activity: ev.activity, companions: ev.companions, note: ev.note }
        : {},
      intensity: craving?.intensityInitial ?? 5,
      outcome: craving?.outcome ?? 'passed',
      endTime: formatTime(craving?.endTimestamp ?? start + 5 * MIN),
      final: craving?.intensityFinal ?? null,
      strategy: craving?.copingStrategy,
    });
  }, [editing, day?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e || !d || !draft) return null;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const isNew = e.event === null;

  const save = async () => {
    const ts = Math.min(timestampInDay(d, draft.time), now);
    if (e.kind === 'cigarette') {
      if (e.event) await updateCigarette(e.event.id, { ...draft.ctx, timestamp: ts });
      else await addCigarette(ts, draft.ctx);
    } else {
      const resolved = draft.outcome !== 'active';
      const patch: Partial<CravingEvent> = {
        ...draft.ctx,
        startTimestamp: ts,
        intensityInitial: draft.intensity,
        outcome: draft.outcome,
        endTimestamp: resolved ? Math.min(Math.max(ts, timestampInDay(d, draft.endTime)), now) : undefined,
        intensityFinal: resolved ? (draft.final ?? undefined) : undefined,
        copingStrategy: draft.strategy,
      };
      if (e.event) await updateCraving(e.event.id, patch);
      else {
        const created = await addCraving(draft.intensity, draft.ctx, ts);
        await updateCraving(created.id, patch);
      }
    }
    onClose();
  };

  const remove = async () => {
    if (!e.event) return;
    if (e.kind === 'cigarette') {
      const removed = await deleteCigarette(e.event.id);
      if (removed) notify('Zigarette gelöscht', () => void restoreCigarette(removed));
    } else {
      const removed = await deleteCraving(e.event.id);
      if (removed) notify('Verlangen gelöscht', () => void restoreCraving(removed));
    }
    onClose();
  };

  return (
    <Sheet
      open={editing !== null}
      onClose={onClose}
      tall={e.kind === 'craving'}
      title={e.kind === 'cigarette' ? 'Zigarette' : 'Verlangen'}
      leading={<SheetAction onClick={onClose}>Abbrechen</SheetAction>}
      trailing={
        <SheetAction strong onClick={() => void save()}>
          Sichern
        </SheetAction>
      }
    >
      <div className="space-y-4 pt-2">
        <div className="overflow-hidden rounded-[22px] bg-fill">
          <TimeRow label={e.kind === 'craving' ? 'Beginn' : 'Uhrzeit'} value={draft.time} onChange={(time) => set({ time })} />
          {e.kind === 'craving' && draft.outcome !== 'active' && (
            <div className="border-t-[0.5px] border-sep">
              <TimeRow label="Ende" value={draft.endTime} onChange={(endTime) => set({ endTime })} />
            </div>
          )}
        </div>

        {e.kind === 'craving' && (
          <>
            <div>
              <SectionLabel>Stärke</SectionLabel>
              <IntensityScale value={draft.intensity} onChange={(intensity) => set({ intensity })} />
            </div>
            <div>
              <SectionLabel>Ergebnis</SectionLabel>
              <Segmented
                label="Ergebnis"
                value={draft.outcome}
                onChange={(outcome) => set({ outcome })}
                options={[
                  { value: 'passed', label: 'Überstanden' },
                  { value: 'smoked', label: 'Geraucht' },
                  { value: 'active', label: 'Offen' },
                ]}
              />
            </div>
            {draft.outcome !== 'active' && (
              <div>
                <SectionLabel>Strategie</SectionLabel>
                <ChipSelect
                  options={[...COPING_STRATEGIES, 'Einfach abgewartet', ...(settings.customOptions.coping ?? [])]}
                  value={draft.strategy}
                  onChange={(strategy) => set({ strategy })}
                />
              </div>
            )}
          </>
        )}

        <div>
          <SectionLabel>Kontext</SectionLabel>
          <ContextFields value={draft.ctx} onChange={(ctx) => set({ ctx })} settings={settings} withNote />
        </div>

        {!isNew && (
          <Button variant="danger" onClick={() => void remove()}>
            <Icon name="trash" size={18} />
            Löschen
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function TimeRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-h-[50px] items-center justify-between gap-3 px-4 text-[16px]">
      <span>{label}</span>
      <input
        type="time"
        value={value}
        onChange={(ev) => ev.target.value && onChange(ev.target.value)}
        className="num rounded-xl bg-fill px-3 py-1.5 text-ink outline-none"
      />
    </label>
  );
}

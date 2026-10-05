import { useMemo, useState } from 'react';
import { generateInsights } from '../../analytics/insights';
import { effectiveCount, hourHistogram, triggerRanking } from '../../analytics/stats';
import { cigarettes, dayLabel, euro, num, plural } from '../../domain/format';
import { MIN, formatMinutes } from '../../domain/time';
import type { Settings } from '../../domain/types';
import { calculateMoneySaved, wholeAvoided } from '../../engine/avoided';
import type { AppModel } from '../../engine/model';
import { BarChart, Legend, LineChart, NEUTRAL_COLOR, PLOT_COLOR, RankList, sparseLabels } from '../components/charts';
import { Card, EmptyState, SectionLabel, Segmented } from '../components/controls';

type Range = '7' | '14' | 'all';

/** Zuerst nur die wichtigsten Aussagen – der Rest ist einen Tipp entfernt. */
const VISIBLE_INSIGHTS = 4;

export function InsightsScreen({ model, settings }: { model: AppModel; settings: Settings }) {
  const [range, setRange] = useState<Range>('14');
  const [showAll, setShowAll] = useState(false);
  const insights = useMemo(() => generateInsights(model, settings), [model, settings]);

  const span = range === 'all' ? model.days.length : Math.min(Number(range), model.days.length);
  const days = model.days.slice(-span);
  const axis = sparseLabels(
    days.map((d) => (days.length <= 7 ? dayLabel(d.date, 'weekday') : dayLabel(d.date, 'short'))),
    days.length <= 7 ? 7 : 5,
  );
  const label = (i: number) => (days[i].isToday ? 'Heute' : dayLabel(days[i].date));

  // Gleitender 7-Tage-Schnitt über abgeschlossene, auswertbare Tage.
  const trend = useMemo(() => {
    const all = model.days.map((d, i) => {
      const window = model.days.slice(Math.max(0, i - 6), i + 1).filter((x) => x.usable);
      return d.usable && window.length >= 2 ? window.reduce((s, x) => s + effectiveCount(x), 0) / window.length : null;
    });
    return all.slice(-span);
  }, [model.days, span]);

  const observed = days.filter((d) => d.observed);
  const totalCigs = observed.reduce((s, d) => s + d.cigarettes.length, 0);
  const completeObserved = observed.filter((d) => d.complete);
  const avg = completeObserved.length
    ? completeObserved.reduce((s, d) => s + d.cigarettes.length, 0) / completeObserved.length
    : null;

  const firstPoints = days.map((d, i) => ({
    key: d.date,
    label: label(i),
    axisLabel: axis[i],
    value: d.cigarettes.length ? model.clock.wakeMin + (d.cigarettes[0].timestamp - d.wakeTs) / MIN : null,
  }));
  const firstValues = firstPoints.map((p) => p.value).filter((v): v is number => v !== null);

  const cravingTotal = days.reduce((s, d) => s + d.cravings.length, 0);
  const cravingPassed = days.reduce((s, d) => s + d.summary.cravingsPassed, 0);

  // Kumuliert über den gesamten Plan, angezeigt wird der gewählte Ausschnitt.
  const cumulative = useMemo(() => {
    let sum = 0;
    return model.days.map((d) => wholeAvoided((sum += d.avoidedRaw)));
  }, [model.days]).slice(-span);

  const triggers = triggerRanking(model, span).slice(0, 6);
  const hours = hourHistogram(model, span);
  const hoursTotal = hours.reduce((a, b) => a + b, 0);
  const peakHour = hours.indexOf(Math.max(...hours));

  const hasData = model.days.some((d) => d.cigarettes.length > 0 || d.cravings.length > 0);
  if (!hasData) {
    return (
      <EmptyState
        title="Noch keine Auswertung"
        text="Sobald die ersten Einträge da sind, erscheinen hier Muster und Verläufe."
      />
    );
  }

  return (
    <div className="space-y-4">
      {insights.length > 0 ? (
        <Card className="py-1">
          <ul>
            {(showAll ? insights : insights.slice(0, VISIBLE_INSIGHTS)).map((ins, i) => (
              <li key={ins.id} className={`py-3.5 ${i ? 'border-t-[0.5px] border-sep' : ''}`}>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink3">{ins.label}</p>
                <p className="mt-1 text-[16px] leading-snug">{ins.text}</p>
              </li>
            ))}
          </ul>
          {insights.length > VISIBLE_INSIGHTS && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="min-h-[46px] w-full border-t-[0.5px] border-sep text-left text-[15px] text-accent"
            >
              {showAll ? 'Weniger anzeigen' : `${insights.length - VISIBLE_INSIGHTS} weitere Beobachtungen`}
            </button>
          )}
        </Card>
      ) : (
        <Card>
          <p className="text-[15px] leading-snug text-ink2">
            Für belastbare Aussagen braucht es noch ein paar Tage. Die Verläufe unten füllen sich bereits.
          </p>
        </Card>
      )}

      <div className="pt-2">
        <SectionLabel>Verlauf</SectionLabel>
        <Segmented
          label="Zeitraum"
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7 Tage' },
            { value: '14', label: '14 Tage' },
            { value: 'all', label: 'Gesamt' },
          ]}
        />
      </div>

      <Card>
        <BarChart
          title="Zigaretten pro Tag"
          summary={avg !== null ? `Ø ${num(avg, 1)}` : cigarettes(totalCigs)}
          ariaLabel={`Zigaretten pro Tag über ${days.length} Tage, insgesamt ${totalCigs}`}
          data={days.map((d, i) => ({ key: d.date, label: label(i), axisLabel: axis[i], value: d.cigarettes.length }))}
          line={trend}
          format={(d) => cigarettes(d.value)}
        />
        <Legend
          items={[
            { label: 'Tageswert', color: PLOT_COLOR },
            { label: '7-Tage-Schnitt', color: 'var(--ink)', line: true },
          ]}
        />
      </Card>

      {firstValues.length >= 2 && (
        <Card>
          <LineChart
            title="Zeitpunkt der ersten Zigarette"
            summary={`Ø ${formatMinutes(firstValues.reduce((a, b) => a + b, 0) / firstValues.length)} Uhr`}
            ariaLabel="Uhrzeit der ersten Zigarette je Tag"
            points={firstPoints}
            format={(p) => (p.value === null ? 'keine Zigarette' : `${formatMinutes(p.value)} Uhr`)}
            formatTick={(v) => formatMinutes(Math.round(v / 5) * 5)}
          />
        </Card>
      )}

      {cravingTotal > 0 && (
        <Card>
          <BarChart
            title="Verlangen pro Tag"
            summary={`${num(cravingPassed)} von ${num(cravingTotal)} überstanden`}
            ariaLabel={`Verlangen pro Tag, ${cravingPassed} von ${cravingTotal} überstanden`}
            data={days.map((d, i) => ({
              key: d.date,
              label: label(i),
              axisLabel: axis[i],
              value: d.summary.cravingsPassed,
              secondary: d.cravings.length - d.summary.cravingsPassed,
            }))}
            format={(d) => `${num(d.value)} von ${num(d.value + (d.secondary ?? 0))} überstanden`}
            height={130}
          />
          <Legend
            items={[
              { label: 'Überstanden', color: PLOT_COLOR },
              { label: 'Geraucht oder offen', color: NEUTRAL_COLOR },
            ]}
          />
        </Card>
      )}

      {triggers.length > 0 && (
        <Card>
          <p className="pb-3 text-[13px] font-medium text-ink2">Auslöser</p>
          <RankList items={triggers} unit={(n) => plural(n, 'Eintrag', 'Einträge')} />
        </Card>
      )}

      {hoursTotal >= 5 && (
        <Card>
          <BarChart
            title="Konsum nach Tageszeit"
            summary={`Am häufigsten ${peakHour}–${peakHour + 1} Uhr`}
            ariaLabel={`Zigaretten nach Uhrzeit, am häufigsten zwischen ${peakHour} und ${peakHour + 1} Uhr`}
            data={hours.map((value, h) => ({
              key: String(h),
              label: `${h}–${h + 1} Uhr`,
              axisLabel: h % 6 === 0 ? `${h}` : undefined,
              value,
            }))}
            format={(d) => cigarettes(d.value)}
            height={130}
          />
        </Card>
      )}

      <Card>
        <LineChart
          title="Vermieden seit Start"
          summary={`${cigarettes(model.totals.avoided)} · ${euro(model.totals.moneySaved)}`}
          ariaLabel={`Kumulativ vermiedene Zigaretten, aktuell ${model.totals.avoided}`}
          points={days.map((d, i) => ({ key: d.date, label: label(i), axisLabel: axis[i], value: cumulative[i] }))}
          format={(p) =>
            `${cigarettes(p.value ?? 0)} · ${euro(calculateMoneySaved(p.value ?? 0, settings.packPrice, settings.cigarettesPerPack))}`
          }
          formatTick={(v) => String(Math.round(v))}
          area
          zeroBased
          height={130}
        />
      </Card>
    </div>
  );
}

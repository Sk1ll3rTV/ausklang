import { STATUS_LABEL, cigarettes, duration, num, pct, plural } from '../domain/format';
import type { Settings } from '../domain/types';
import type { AppModel } from '../engine/model';
import {
  compareTodayWithUsual,
  copingStats,
  cravingRates,
  easiestSlot,
  effectiveCount,
  firstCigaretteShift,
  hotWindow,
  hourHistogram,
  recentReduction,
  triggerFollowUps,
  triggerRanking,
  usableDays,
} from './stats';

/**
 * Lokaler Coach: beantwortet die Standardfragen deterministisch aus den Kennzahlen.
 * Funktioniert vollständig offline. Die optionale KI formuliert auf dieser Grundlage nur aus.
 */

export type QuestionId =
  | 'today'
  | 'when'
  | 'trigger'
  | 'easiest'
  | 'reduction'
  | 'pace'
  | 'zero'
  | 'tomorrow'
  | 'coping';

export const QUESTIONS: { id: QuestionId; label: string; keywords: string[] }[] = [
  { id: 'today', label: 'Warum rauche ich heute mehr?', keywords: ['heute', 'warum', 'mehr'] },
  { id: 'when', label: 'Wann rauche ich am meisten?', keywords: ['wann', 'meisten', 'uhrzeit', 'tageszeit'] },
  { id: 'trigger', label: 'Was ist mein stärkster Trigger?', keywords: ['trigger', 'auslöser', 'ausloeser'] },
  { id: 'easiest', label: 'Welche Zigarette dürfte am einfachsten wegfallen?', keywords: ['einfach', 'wegfallen', 'welche'] },
  { id: 'reduction', label: 'Wie stark habe ich reduziert?', keywords: ['reduziert', 'weniger', 'fortschritt', 'stark'] },
  { id: 'pace', label: 'Wird mein Plan zu schnell?', keywords: ['schnell', 'plan', 'tempo'] },
  { id: 'zero', label: 'Wann könnte ich bei 0 sein?', keywords: ['null', '0', 'rauchfrei', 'fertig'] },
  { id: 'tomorrow', label: 'Welche Situationen sollte ich morgen beobachten?', keywords: ['morgen', 'situation', 'beobachten'] },
  { id: 'coping', label: 'Was hat bei starken Cravings bisher funktioniert?', keywords: ['craving', 'verlangen', 'funktioniert', 'geholfen', 'hilft'] },
];

const NOT_ENOUGH = 'Dafür reichen die Daten noch nicht. Nach ein paar Tagen mit Einträgen kann ich das belastbar beantworten.';

const sentence = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ');

function forecastText(model: AppModel): string | null {
  const f = model.forecast;
  if (!f) return null;
  if (model.today.plan.internalTarget === 0) return 'Dein aktueller Bereich liegt bereits bei 0.';
  const range = f.minDays === f.maxDays ? `${num(f.minDays)}` : `${num(f.minDays)}–${num(f.maxDays)}`;
  return `Dein aktueller Verlauf spricht dafür, dass 0 Zigaretten innerhalb der nächsten ${range} Tage realistisch sein könnten, wenn sich der Trend hält.`;
}

export function answerQuestion(id: QuestionId, model: AppModel, settings: Settings): string {
  switch (id) {
    case 'today': {
      const cmp = compareTodayWithUsual(model);
      const status = model.today.plan.status;
      if (!cmp) {
        return sentence([
          `Heute sind es bisher ${cigarettes(model.today.cigarettes.length)}.`,
          'Für einen Vergleich mit deinen üblichen Tagen fehlen noch ein paar abgeschlossene Tage.',
        ]);
      }
      const diff = cmp.count - cmp.usualByNow;
      if (diff < 1) {
        return `Heute liegst du nicht über deinem üblichen Verlauf: ${cigarettes(cmp.count)} bisher, an den letzten ${cmp.days} Tagen waren es um diese Uhrzeit im Schnitt ${num(cmp.usualByNow, 1)}.`;
      }
      const top = cmp.triggers[0];
      return sentence([
        `Heute sind es bisher ${cigarettes(cmp.count)}, um diese Uhrzeit üblich waren zuletzt ${num(cmp.usualByNow, 1)}.`,
        cmp.block &&
          `Der größte Unterschied entstand zwischen ${cmp.block.fromHour} und ${cmp.block.toHour} Uhr (${num(cmp.block.today)} statt üblicherweise ${num(cmp.block.usual, 1)}).`,
        top && top.count >= 2 && `${num(top.count)} der heutigen Zigaretten hast du mit „${top.name}“ markiert.`,
        status === 'red' && 'Das ist eine Beobachtung, kein Urteil – morgen wird dein Bereich deshalb nicht enger.',
      ]);
    }

    case 'when': {
      const hours = hourHistogram(model);
      const total = hours.reduce((a, b) => a + b, 0);
      if (total < 8) return NOT_ENOUGH;
      const hot = hotWindow(model);
      const peak = hours.indexOf(Math.max(...hours));
      return sentence([
        hot
          ? `Am meisten rauchst du zwischen ${hot.fromHour} und ${hot.toHour} Uhr – etwa ${num(hot.factor, 1)}-mal so häufig wie im Tagesdurchschnitt.`
          : `Dein Konsum verteilt sich recht gleichmäßig über den Tag. Die häufigste Stunde ist ${peak}–${peak + 1} Uhr.`,
        `Grundlage: ${num(total)} Zigaretten der letzten 14 Tage.`,
      ]);
    }

    case 'trigger': {
      const ranking = triggerRanking(model);
      if (!ranking[0] || ranking[0].count < 3) {
        return 'Bisher sind zu wenige Einträge mit einem Auslöser markiert. Wenn du bei Zigaretten oder Verlangen gelegentlich einen Auslöser ergänzt, wird das Bild schnell klarer.';
      }
      const follow = triggerFollowUps(model).find((f) => f.trigger === ranking[0].name);
      return sentence([
        `Dein stärkster Auslöser ist momentan ${ranking[0].name} (${num(ranking[0].count)} Einträge in 14 Tagen).`,
        ranking[1] && `Danach folgt ${ranking[1].name} mit ${num(ranking[1].count)}.`,
        follow &&
          `Auf ein Verlangen mit diesem Auslöser folgte in ${pct(follow.followed / follow.total)} der Fälle innerhalb von 20 Minuten eine Zigarette.`,
      ]);
    }

    case 'easiest': {
      const easy = easiestSlot(model);
      if (!easy) return NOT_ENOUGH;
      return sentence([
        `Am einfachsten dürfte die Zigarette gegen ${easy.hour} Uhr wegfallen: Sie kam zuletzt nur an ${easy.present} von ${easy.total} Tagen vor.`,
        easy.trigger && `Meist steht sie im Zusammenhang mit „${easy.trigger}“.`,
        'Sie fällt also bereits an den meisten Tagen aus, ohne dass der Tag dadurch schwieriger wurde.',
      ]);
    }

    case 'reduction': {
      const r = recentReduction(model, settings.baselineCigarettesPerDay);
      const shift = firstCigaretteShift(model, settings.baselineFirstCigaretteDelayMin);
      if (!r) {
        return `Seit dem Start hast du ${cigarettes(model.totals.avoided)} gegenüber deinem Ausgangsniveau vermieden. Für einen Durchschnittswert fehlen noch abgeschlossene Tage.`;
      }
      return sentence([
        `Im Schnitt der letzten ${r.days} Tage rauchst du ${num(r.average, 1)} statt ${num(settings.baselineCigarettesPerDay)} Zigaretten am Tag – ${pct(Math.max(0, r.ratio))} weniger.`,
        `Seit dem Start sind das ${cigarettes(model.totals.avoided)} weniger.`,
        shift && shift.shiftMin >= 10 && `Die erste Zigarette liegt durchschnittlich ${duration(shift.shiftMin)} später.`,
      ]);
    }

    case 'pace': {
      const days = usableDays(model).slice(-4);
      if (days.length < 3) return NOT_ENOUGH;
      const over = days.filter((d) => d.summary.status && d.summary.status !== 'green').length;
      const rates = cravingRates(model, 4);
      const strongPerDay = rates.strong.total / days.length;
      const strained = strongPerDay >= 3 && rates.strong.passed / Math.max(1, rates.strong.total) < 0.5;
      if (over >= 2 || strained) {
        return sentence([
          over >= 2 && `An ${over} der letzten ${days.length} Tage lagst du über deinem Bereich.`,
          strained && `Dazu kamen im Schnitt ${num(strongPerDay, 1)} starke Verlangen pro Tag.`,
          'Das spricht dafür, dass das Tempo gerade am oberen Rand liegt. Der Plan hält den Bereich in solchen Phasen automatisch, statt weiter zu senken.',
        ]);
      }
      return sentence([
        `An ${days.length - over} der letzten ${days.length} Tage lagst du in deinem Bereich.`,
        rates.strong.total > 0
          ? `Starke Verlangen: ${num(rates.strong.total)}, davon ${num(rates.strong.passed)} ohne Zigarette überstanden.`
          : 'Starke Verlangen hast du in dieser Zeit nicht eingetragen.',
        'Aktuell deutet nichts darauf hin, dass der Plan zu schnell ist.',
      ]);
    }

    case 'zero':
      return model.usableDays < 2
        ? sentence([
            'Der Plan zielt auf ungefähr zwei bis drei Wochen ab dem Start.',
            'Eine persönliche Schätzung ist nach ein paar abgeschlossenen Tagen möglich.',
          ])
        : (forecastText(model) ?? NOT_ENOUGH);

    case 'tomorrow': {
      const hot = hotWindow(model);
      const top = triggerRanking(model)[0];
      const parts = [
        hot && `das Zeitfenster zwischen ${hot.fromHour} und ${hot.toHour} Uhr`,
        top && top.count >= 3 && `Situationen mit „${top.name}“`,
        model.today.plan.internalTarget > 0 &&
          `den Morgen – ein guter Bereich für die erste Zigarette liegt bei ${model.firstCigarette.targetStart}–${model.firstCigarette.targetEnd} Uhr`,
      ].filter((p): p is string => Boolean(p));
      if (!parts.length) return NOT_ENOUGH;
      return `Beobachtenswert für morgen: ${parts.join('; ')}. Es reicht, diese Momente wahrzunehmen – eintragen genügt.`;
    }

    case 'coping': {
      const strong = copingStats(model, { strongOnly: true }).filter((c) => c.tried >= 2);
      const any = copingStats(model).filter((c) => c.tried >= 2);
      const list = strong.length ? strong : any;
      if (!list.length) {
        return 'Bisher gibt es zu wenige Verlangen mit einer notierten Strategie. Der „Hilf mir kurz“-Modus merkt sich automatisch, was du ausprobiert hast und wie es ausging.';
      }
      const lines = list.slice(0, 3).map((c) => `„${c.strategy}“ ${c.worked} von ${c.tried} Mal`);
      return `${strong.length ? 'Bei starken Verlangen' : 'Bei Verlangen insgesamt'} hat funktioniert: ${lines.join(', ')}.`;
    }
  }
}

/** Kurze Tagesanalyse für den Kopf des Coach-Tabs. */
export function dailyBriefing(model: AppModel, settings: Settings): string {
  const today = model.today;
  const count = today.cigarettes.length;
  const status = today.plan.status ?? 'green';
  const cmp = compareTodayWithUsual(model);
  const passed = today.cravings.filter((c) => c.outcome === 'passed').length;

  const lead =
    status === 'green'
      ? count === 0
        ? 'Heute ist bisher keine Zigarette eingetragen.'
        : `Heute liegst du mit ${cigarettes(count)} in deinem Bereich.`
      : status === 'orange'
        ? `Heute liegst du mit ${cigarettes(count)} etwas über deinem üblichen Reduktionsbereich.`
        : `Heute liegt dein Konsum mit ${cigarettes(count)} deutlich über deinem aktuellen Bereich.`;

  return sentence([
    lead,
    status !== 'green' &&
      cmp?.block &&
      `Der größte Unterschied entstand zwischen ${cmp.block.fromHour} und ${cmp.block.toHour} Uhr.`,
    status !== 'green' &&
      cmp &&
      cmp.triggers[0]?.count >= 2 &&
      `${num(cmp.triggers[0].count)} Zigaretten folgten auf „${cmp.triggers[0].name}“.`,
    passed > 0 && `${plural(passed, 'Verlangen', 'Verlangen')} hast du heute ohne Zigarette überstanden.`,
    status === 'red' && 'Morgen wird nicht automatisch härter.',
    model.usableDays >= 3 && status === 'green' && forecastText(model),
    model.usableDays === 0 &&
      `Der Plan startet bei deinem Ausgangsniveau von ${num(settings.baselineCigarettesPerDay)} und passt sich ab morgen an deinen Verlauf an.`,
  ]);
}

/** Ordnet eine frei formulierte Frage der passendsten Standardfrage zu. */
export function matchQuestion(text: string): QuestionId | null {
  const t = text.toLowerCase();
  let best: { id: QuestionId; score: number } | null = null;
  for (const q of QUESTIONS) {
    const score = q.keywords.filter((k) => (k.length <= 2 ? new RegExp(`\\b${k}\\b`).test(t) : t.includes(k))).length;
    if (score > 0 && (!best || score > best.score)) best = { id: q.id, score };
  }
  return best?.id ?? null;
}

/**
 * Verdichteter Kontext für die optionale KI. Enthält ausschließlich Kennzahlen und Kategorien,
 * keine Freitext-Notizen und keine einzelnen Zeitstempel.
 */
export function buildCoachContext(model: AppModel, settings: Settings) {
  const days = model.days.slice(-14);
  const rates = cravingRates(model);
  return {
    baselinePerDay: settings.baselineCigarettesPerDay,
    planDay: model.days.length,
    today: {
      cigarettes: model.today.cigarettes.length,
      status: STATUS_LABEL[model.today.plan.status ?? 'green'],
      targetRange: model.today.plan.internalTargetRange,
      projected: model.today.plan.projectedConsumption,
      firstCigarette: model.today.summary.firstCigaretteTime,
      cravings: model.today.cravings.length,
      cravingsPassed: model.today.summary.cravingsPassed,
    },
    recentDays: days
      .filter((d) => d.complete && d.observed)
      .map((d) => ({
        date: d.date,
        cigarettes: Math.round(effectiveCount(d)),
        target: d.plan.internalTarget,
        status: d.summary.status,
        firstCigarette: d.summary.firstCigaretteTime,
        cravings: d.summary.cravings,
        cravingsPassed: d.summary.cravingsPassed,
      })),
    avoidedSinceStart: model.totals.avoided,
    moneySaved: Math.round(model.totals.moneySaved * 100) / 100,
    forecastDaysToZero: model.forecast,
    hourHistogram: hourHistogram(model),
    triggers: triggerRanking(model).slice(0, 6),
    cravingRates: rates,
    triggerFollowUps: triggerFollowUps(model).slice(0, 4),
    copingStrategies: copingStats(model).slice(0, 6),
    easiestSlot: easiestSlot(model),
    firstCigaretteShiftMin: firstCigaretteShift(model, settings.baselineFirstCigaretteDelayMin)?.shiftMin ?? null,
  };
}

export type CoachContext = ReturnType<typeof buildCoachContext>;

import { duration, num, pct } from '../domain/format';
import type { Settings } from '../domain/types';
import type { AppModel } from '../engine/model';
import {
  companyShare,
  copingStats,
  cravingRates,
  easiestSlot,
  firstCigaretteShift,
  hotWindow,
  leadOverPlan,
  recentReduction,
  triggerFollowUps,
  triggerRanking,
} from './stats';

export interface Insight {
  id: string;
  /** Kurze Einordnung über dem Satz. */
  label: string;
  text: string;
}

/**
 * Erzeugt die Text-Insights. Rein regelbasiert und lokal – jede Aussage erscheint nur,
 * wenn genug Daten dafür vorliegen. Reihenfolge = Relevanz.
 */
export function generateInsights(model: AppModel, settings: Settings): Insight[] {
  const out: Insight[] = [];

  const reduction = recentReduction(model, settings.baselineCigarettesPerDay);
  if (reduction && reduction.ratio >= 0.03) {
    out.push({
      id: 'reduction',
      label: 'Verlauf',
      text:
        reduction.days >= 7
          ? `Diese Woche rauchst du ${pct(reduction.ratio)} weniger als zu deinem Ausgangsniveau.`
          : `In den letzten ${reduction.days} Tagen rauchst du ${pct(reduction.ratio)} weniger als zu deinem Ausgangsniveau.`,
    });
  }

  const lead = leadOverPlan(model);
  if (lead) {
    out.push({
      id: 'lead',
      label: 'Tempo',
      text: `In den letzten ${lead.days} Tagen sank dein Verbrauch schneller als geplant.`,
    });
  }

  const shift = firstCigaretteShift(model, settings.baselineFirstCigaretteDelayMin);
  if (shift && shift.shiftMin >= 10) {
    out.push({
      id: 'first',
      label: 'Erste Zigarette',
      text: `Deine erste Zigarette liegt aktuell durchschnittlich ${duration(shift.shiftMin)} später als zu Beginn.`,
    });
  }

  const hot = hotWindow(model);
  if (hot) {
    out.push({
      id: 'hot',
      label: 'Tageszeit',
      text: `Zwischen ${hot.fromHour} und ${hot.toHour} Uhr rauchst du überdurchschnittlich häufig.`,
    });
  }

  const triggers = triggerRanking(model);
  if (triggers[0] && triggers[0].count >= 3) {
    out.push({
      id: 'trigger',
      label: 'Auslöser',
      text: `Dein stärkster Auslöser ist momentan ${triggers[0].name}.`,
    });
  }

  const rates = cravingRates(model);
  if (rates.mild.total >= 4) {
    out.push({
      id: 'mild',
      label: 'Verlangen',
      text: `Verlangen mit Stärke bis 6 überstehst du in ${pct(rates.mild.passed / rates.mild.total)} der Fälle ohne Zigarette.`,
    });
  }
  if (rates.strong.total >= 4) {
    out.push({
      id: 'strong',
      label: 'Starke Verlangen',
      text: `Von ${rates.strong.total} starken Verlangen (ab 7) hast du ${rates.strong.passed} ohne Zigarette überstanden.`,
    });
  }

  // Nur nennenswerte Zusammenhänge – der deutlichste zuerst.
  const follow = triggerFollowUps(model)
    .filter((f) => f.followed / f.total >= 0.4)
    .sort((a, b) => b.followed / b.total - a.followed / a.total)[0];
  if (follow) {
    out.push({
      id: 'follow',
      label: 'Muster',
      text: `Auf Verlangen mit dem Auslöser „${follow.trigger}“ folgt bei dir in ${pct(follow.followed / follow.total)} der Fälle innerhalb von 20 Minuten eine Zigarette.`,
    });
  }

  const coping = copingStats(model, { strongOnly: true, byLocation: true }).find((c) => c.tried >= 3);
  const copingAny = copingStats(model).find((c) => c.tried >= 3);
  if (coping) {
    out.push({
      id: 'coping',
      label: 'Was hilft',
      text: `Bei starken Verlangen (${coping.location}) hat „${coping.strategy}“ bei dir bisher ${coping.worked} von ${coping.tried} Mal funktioniert.`,
    });
  } else if (copingAny) {
    out.push({
      id: 'coping',
      label: 'Was hilft',
      text: `„${copingAny.strategy}“ hat bei dir bisher ${copingAny.worked} von ${copingAny.tried} Mal funktioniert.`,
    });
  }

  const company = companyShare(model);
  if (company) {
    const share = company.withOthers / company.total;
    out.push({
      id: 'company',
      label: 'Gesellschaft',
      text:
        share >= 0.5
          ? `${pct(share)} deiner Zigaretten mit Angabe rauchst du aktuell in Gesellschaft.`
          : `${pct(1 - share)} deiner Zigaretten mit Angabe rauchst du aktuell allein.`,
    });
  }

  const easy = easiestSlot(model);
  if (easy) {
    out.push({
      id: 'easy',
      label: 'Nächster Schritt',
      text: `Die Zigarette gegen ${easy.hour} Uhr kam zuletzt nur an ${easy.present} von ${easy.total} Tagen vor – sie scheint aktuell eine der am einfachsten zu eliminierenden zu sein.`,
    });
  }

  if (model.forecast && model.today.plan.internalTarget > 0 && model.usableDays >= 3) {
    const { minDays, maxDays } = model.forecast;
    out.push({
      id: 'forecast',
      label: 'Ausblick',
      text:
        minDays === maxDays
          ? `Hält sich der Trend, sind 0 Zigaretten in etwa ${num(minDays)} Tagen realistisch.`
          : `Hält sich der Trend, sind 0 Zigaretten in etwa ${num(minDays)}–${num(maxDays)} Tagen realistisch.`,
    });
  }

  return out;
}

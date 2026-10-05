# Reduction Engine

Die Engine liegt in `src/engine/` und ist reines TypeScript ohne UI-, Browser- oder
Datenbankabhängigkeit. Alles wird bei jedem Aufruf aus den Rohdaten neu abgeleitet – es gibt
keinen versteckten Zustand. Wer ein Event löscht oder ändert, bekommt beim nächsten Aufruf
automatisch neu berechnete Tageswerte.

Tests: `src/engine/engine.test.ts` (`npm test`).

## Dateien

| Datei | Inhalt | Zentrale Funktionen |
| --- | --- | --- |
| `domain/time.ts` | Logischer Tag, Wachfenster | `dayClock`, `dayKeyOf`, `wakeTime`, `sleepTime` |
| `engine/plan.ts` | Adaptiver Reduktionspfad | `calculateDailyPlan`, `runPlan`, `advancePlan`, `estimateDaysToZero` |
| `engine/status.ts` | Prognose und Grün/Orange/Rot | `calculateProjectedConsumption`, `calculateDailyStatus`, `classifyStatus`, `finalDayStatus` |
| `engine/firstCigarette.ts` | Bereich für die erste Zigarette | `calculateFirstCigaretteTarget`, `advanceFirstCig` |
| `engine/avoided.ts` | Vermiedene Zigaretten, Geld | `calculateAvoidedCigarettes`, `expectedBaseline`, `calculateMoneySaved` |
| `engine/model.ts` | Setzt alles zusammen | `buildModel` |
| `analytics/insights.ts` | Text-Insights | `generateInsights` |

## 1. Zeitmodell

- **Wachfenster**: von `usualWakeTime` bis `usualSleepTime` (Standard 07:00–00:00 = 17 h).
- **Logischer Tag**: wechselt in der **Schlafmitte** (Standard 03:30), nicht um Mitternacht.
  Eine Zigarette um 00:40 gehört damit zum Vortag. Der Tag trägt das Datum des Aufwachens.
- Unplausible Zeiten (Wachzeit < 4 h oder > 23 h) fallen auf 17 h zurück.

## 2. Welche Tage zählen

`buildModel` erzeugt pro Tag seit Planstart einen `DayRecord` mit drei Merkmalen:

- `observed`: Es gibt Einträge, die App wurde an dem Tag geöffnet (`dayMarks`) oder der Nutzer
  hat den Tag im Verlauf als rauchfrei bestätigt. Unbeobachtete Tage werden **nicht** als
  „0 Zigaretten“ gewertet – sonst würde eine Woche ohne App den Plan fälschlich auf 0 treiben.
- `coverage`: Anteil des Wachfensters, der seit dem Planstart erfasst ist. Nur am Starttag < 1.
- `usable`: abgeschlossen, beobachtet und `coverage ≥ 0,75`. Nur diese Tage steuern den Plan.
  Ein angebrochener Starttag mit ≥ 75 % wird hochgerechnet (`count / coverage`), darunter ignoriert.

## 3. Reduktionspfad (`plan.ts`)

Intern gibt es ein kontinuierliches **Niveau** `level`. Das Tagesziel ist `round(level)`, der
Zielbereich `[ziel − 1, ziel]`; unter 0,75 ist das Ziel 0.

- Start: `level = baseline × 0,9` (bei 20 → Bereich 17–18).
- Regulärer Schritt pro Tag: `s = baseline / ((minDays + maxDays) / 2)` (bei 20 und 14–21 Tagen ≈ 1,14).
  Planmäßig wird 0 damit an Tag 17 erreicht.

Nach jedem abgeschlossenen, auswertbaren Tag mit Menge `a` und Ziel `T` (Grenzen aus
`statusLimits(T)`, siehe Abschnitt 4):

| Fall | Bedingung | Neues Niveau | `step` |
| --- | --- | --- | --- |
| Ausreißer | `a` über Grün-Grenze **und** `a > Ø7 + max(3, 0,4·Ø7)` | unverändert, zählt nicht zur Serie | `outlier` |
| Deutlich darüber | `a` über Rot-Grenze | unverändert | `held` |
| Zweiter Tag darüber | `a` über Grün-Grenze, zweiter Tag in Folge | unverändert | `held` |
| Etwas darüber | `a` über Grün-Grenze, erster Tag | `L − 0,5·s` | `slowed` |
| Klar darunter | `a ≤ L − max(1,5; 0,15·L)` | `L − s − g·(L − a)`, `g = 0,4` (ab 2 Tagen in Folge `0,6`) | `accelerated` |
| Im Bereich | sonst | `L − s` | `normal` |
| Hohe Craving-Last | ≥ 3 starke Verlangen (≥ 7) und < 50 % überstanden | Schritt halbiert, keine Beschleunigung | `slowed` |
| Nicht auswertbar | `usable = false` | unverändert | `paused` |

Zusätzlich gilt nach Tagen **im** Bereich eine Obergrenze: `level ≤ Ø der letzten 3 Tage + 0,5`.
Was real seit drei Tagen niedriger liegt, wird nicht wieder „erlaubt“.

**Invarianten** (durch Tests abgesichert):

1. Das Niveau steigt nie (`next = min(L, …)`).
2. Ein guter Tag führt nie zu einem höheren späteren Ziel.
3. Schwierige Tage halten oder verlangsamen – sie setzen nie zurück und verschärfen nie.
4. Der Pfad hängt an Ergebnissen, nicht an Kalendertagen.

`estimateDaysToZero` schätzt aus den letzten fünf Niveaus eine Spanne (schnell = beobachtetes
Tempo, mindestens `s`; langsam = 75 % davon, mindestens `0,5·s`).

## 4. Tagesstatus (`status.ts`)

**Prognose der Tagesmenge**

```
share  = üblicher Anteil des Tageskonsums bis jetzt (0–1)
pace   = count / share            (ab share > 0,05, sonst prior)
ref    = share · pace + (1 − share) · prior
proj   = count + (1 − share) · ref
```

- `share` kommt aus dem persönlichen Tageszeitprofil (`buildCumulativeShare`): Start ist eine
  Gleichverteilung über die Wachzeit, die sich mit `n / (n + 30)` an die tatsächliche Verteilung
  der letzten 14 auswertbaren Tage annähert.
- `prior = min(Ø der letzten 3 Tage, Ziel)`. Jeder Tag startet damit grün.
- Früh dominiert die Erwartung, spät das tatsächliche Tempo. Eine frühe Zigarette kippt nichts.

**Grenzen** (`statusLimits`)

- Grün bis `max(1,1·T, T + 1)` (bei `T < 3`: `T + 0,5`)
- Rot ab `max(1,3·T, T + 3)` (bei `T < 5`: `T + 2`) – also Prozent **und** absolute Abweichung
- dazwischen Orange

**Stabilisierung**

- Hysterese `h = max(0,5; 0,04·T)`: Ein Wechsel nach oben braucht `Grenze + h`, zurück `Grenze − h`.
- Rot ist erst möglich, wenn 35 % der Wachzeit vergangen sind oder die tatsächliche Menge die
  Rot-Grenze schon überschritten hat.
- Der Tag wird Eintrag für Eintrag nachgespielt (`calculateDailyStatus`). Die Hysterese ergibt sich
  so deterministisch aus den Rohdaten, ohne gespeicherten Zwischenzustand.
- Abgeschlossene Tage: `finalDayStatus(count, T)` ohne Hysterese.

## 5. Erste Zigarette (`firstCigarette.ts`)

Alle Werte in Minuten nach dem Aufstehen.

- Start: `ursprüngliches Muster + 15`, gerundet auf 5 (bei 20 → 07:35–07:55).
- Fensterbreite 20 min, ab 60 min Verzögerung 30 min. Schrittweite 25 bzw. 30 min.
- **Treffer**: erste Zigarette ≥ `Start − 5` und kein starkes Verlangen am Morgen (≥ 7, bis 3 h
  nach dem Aufstehen, vor der ersten Zigarette). Rauchfreie Tage sind Treffer.
- Nach **2 Treffern in Folge** wandert der Bereich einen Schritt nach hinten.
- **Übernahme**: Liegen die letzten zwei Tage beide mindestens 15 min hinter dem Fensterende,
  springt der Bereich so, dass er beim schwächeren der beiden Tage endet. Ein einzelner später
  Tag (Ausschlafen) reicht bewusst nicht.
- Verfehlt oder starkes Morgen-Verlangen → halten. Der Bereich wandert **nie nach vorne**.
- Die App kennt nur die übliche Aufstehzeit aus den Einstellungen, keine tägliche.

## 6. Vermiedene Zigaretten und Geld (`avoided.ts`)

```
erwartet(tag, bis t) = baseline × (Überlappung von [max(Aufstehen, Planstart), min(Schlafen, t)]) / Wachdauer
roh(tag)             = erwartet − tatsächlich      (unbeobachtete Tage: 0)
gesamt               = max(0, floor(Σ roh))
geld                 = gesamt × packPrice / cigarettesPerPack
```

- Die Baseline baut sich nur im Wachfenster auf: nachts wächst der Zähler nicht.
- Vor dem Planstart zählt nichts (kein Sprung beim ersten Öffnen am Nachmittag).
- Einzelne Tage dürfen intern negativ sein; angezeigt wird nie ein negativer Wert.
- Grundlage bleibt immer die **ursprüngliche** Baseline, nicht das aktuelle Ziel.

## 7. Stellschrauben

| Konstante | Datei | Bedeutung |
| --- | --- | --- |
| `baseline × 0.9` in `initialPlanState` | `plan.ts` | Startniveau |
| `nominalStep` | `plan.ts` | Reguläres Tempo |
| Gains `0.4` / `0.6`, Schwelle `max(1.5, 0.15·L)` | `plan.ts` | Wie stark gute Tage beschleunigen |
| `statusLimits` | `status.ts` | Großzügigkeit von Grün, Strenge von Rot |
| `RED_MIN_DAY_SHARE` | `status.ts` | Ab wann Rot möglich ist |
| `n / (n + 30)` in `buildCumulativeShare` | `status.ts` | Lerngeschwindigkeit des Tagesprofils |
| `HITS_TO_SHIFT`, `HIT_GRACE_MIN` | `firstCigarette.ts` | Tempo beim Verschieben der ersten Zigarette |
| `MIN_COVERAGE` | `model.ts` | Ab wann der Starttag zählt |
| `STRONG_CRAVING` | `domain/defaults.ts` | Schwelle für „starkes“ Verlangen |

Nach jeder Änderung `npm test` ausführen – die vier Invarianten aus Abschnitt 3 müssen halten.

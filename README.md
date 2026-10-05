# Ausklang

Eine mobile-first PWA für einen einzelnen Nutzer auf dem iPhone: Zigarettenkonsum ruhig und
adaptiv bis auf null reduzieren.

Die App ist kein Kontrollsystem. Sie zeigt keine verbleibenden Zigaretten, keinen Countdown und
keine „erlaubten“ Uhrzeiten. Sie beobachtet, lernt aus dem tatsächlichen Verlauf und passt den
Reduktionspfad täglich an. Ein schwieriger Tag hält den Plan an, setzt ihn aber nie zurück.

- **Heute**: aktuelle Anzahl, Status (grün/orange/rot mit Text), vermiedene Zigaretten, gespartes
  Geld, guter Bereich für die erste Zigarette. Zwei Aktionen: „Zigarette“ und „Ich habe Verlangen“.
- **Verlauf**: Kalender und Liste, Tages-Timeline, jeder Eintrag bearbeit- und löschbar (mit Undo).
- **Insights**: regelbasierte Textaussagen und Charts.
- **Coach**: beantwortet Fragen lokal aus den Daten; optional formuliert eine KI die Antworten aus.

Alle Daten bleiben auf dem Gerät (IndexedDB). Alle Kernfunktionen laufen offline.

## Tech Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Dexie (IndexedDB) · vite-plugin-pwa (Workbox) ·
Vitest · Cloudflare Workers (Hosting und optionaler KI-Proxy). Charts sind eigenes SVG, ohne
Bibliothek.

## Installation und Entwicklung

Voraussetzung: Node.js ≥ 22.

```bash
npm install
npm run dev        # Entwicklungsserver (http://localhost:5173)
```

Im Entwicklungsmodus gibt es unter Einstellungen → Entwicklung „Demo-Daten laden“. Dieser Code
ist nicht Teil des Production-Bundles; Production startet ohne jegliche Beispielwerte.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm test` | Unit-Tests der Reduction Engine |
| `npm run typecheck` | TypeScript für App und Worker |
| `npm run build` | Typprüfung und Production-Build nach `dist/` |
| `npm run preview` | Production-Build lokal ausliefern (Port 4173) |
| `npm run smoke` | End-to-End-Rauchtest im iPhone-Viewport (braucht `npm run build`, Edge oder Chrome) |
| `npm run icons` | Icons und iOS-Startbilder neu erzeugen |
| `npm run deploy` | Build und `wrangler deploy` |

## Production Build

```bash
npm run build
npm run preview
```

`dist/` enthält die statische App, das Manifest und den Service Worker.

## Datenarchitektur

IndexedDB-Datenbank `ausklang`, Schema-Version 1:

- Rohdaten: `settings`, `cigarettes`, `cravings`, `dayMarks`
- abgeleitet (jederzeit neu berechenbar): `dailyPlans`, `dailySummaries`

Der gesamte App-Zustand wird bei jeder Änderung aus den Rohdaten neu berechnet
(`src/engine/model.ts → buildModel`). Details und Migrationen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Backup**: Einstellungen → „Daten exportieren (JSON)“ sichert alles, „Backup importieren“ prüft
die Datei vollständig und warnt vor dem Überschreiben. Zusätzlich gibt es einen CSV-Export der
Einträge.

## Reduction Engine

Pure TypeScript in `src/engine/`, ohne UI- oder Datenbankabhängigkeit:

- `calculateDailyPlan` – adaptiver Pfad; das Ziel steigt nie
- `calculateDailyStatus` / `calculateProjectedConsumption` – Prognose und Status mit Hysterese
- `calculateFirstCigaretteTarget` – Bereich für die erste Zigarette, wandert nur nach hinten
- `calculateAvoidedCigarettes` – zählt nur in der Wachzeit
- `generateInsights` (`src/analytics/`) – Textaussagen

Algorithmus, Formeln und Stellschrauben: [docs/REDUCTION-ENGINE.md](docs/REDUCTION-ENGINE.md).

## AI-Schicht

Der Coach arbeitet ohne KI vollständig lokal. Optional ergänzt ein Proxy im Cloudflare Worker
natürliche Sprache. Im Frontend liegt kein API-Key; gesendet werden nur verdichtete Kennzahlen.
Einrichtung, Schnittstelle und Datenschutz: [docs/AI-WORKER.md](docs/AI-WORKER.md).

## PWA-Hinweise

Auf dem iPhone in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Die App startet dann im
Standalone-Modus und funktioniert offline.

- iOS hält die Daten einer installierten Home-Screen-App dauerhaft. Im normalen Safari-Tab kann
  iOS Website-Daten nach längerer Nichtnutzung löschen – deshalb installieren und gelegentlich
  ein Backup exportieren.
- Die installierte App und Safari haben getrennte Datenspeicher. Daten wandern per Export/Import.
- Updates kommen automatisch beim nächsten Start mit Netz.
- Es gibt bewusst keine Push-Mitteilungen.

## Deployment (Cloudflare)

Ein Worker liefert App und Proxy aus (`wrangler.jsonc`).

**Automatisch über GitHub (empfohlen)**

1. Cloudflare Dashboard → Workers & Pages → Create → Import a repository → dieses Repo wählen.
2. Build command: `npm run build` · Deploy command: `npx wrangler deploy` · Branch: `main`.
3. Jeder Push auf `main` baut und deployt Production.

**Manuell**

```bash
npx wrangler login
npm run deploy
```

**Nur statisch (ohne KI)**: `dist/` lässt sich auch auf Cloudflare Pages oder jedem anderen
statischen Hosting ausliefern (Build `npm run build`, Ausgabe `dist`). Es gibt keine
Cloudflare-spezifische Abhängigkeit im Frontend.

## Environment Variables

| Name | Wo | Pflicht | Zweck |
| --- | --- | --- | --- |
| `VITE_AI_PROXY_URL` | Build (Frontend) | nein | Standard-Adresse des KI-Proxys. Vorgabe: `/api/coach` |
| `ANTHROPIC_API_KEY` | Worker-Secret | nur für KI | API-Key des KI-Anbieters |
| `COACH_ACCESS_TOKEN` | Worker-Secret | nur für KI | Zugangscode, den der Nutzer in der App einträgt |
| `ALLOWED_ORIGIN` | Worker-Variable | nein | Nur bei getrennten Domains für App und Worker |

Secrets werden mit `npx wrangler secret put <NAME>` gesetzt und gehören nie ins Repo.
Vorlage: [.env.example](.env.example).

## Projektstruktur

```
src/domain        Typen, Zeitmodell, Standardwerte
src/engine        Reduction Engine + Tests
src/analytics     Kennzahlen, Insights, lokaler Coach
src/persistence   IndexedDB, Repository, Backup
src/ai            abstrakte KI-Schicht
src/state         React-Hooks
src/ui            Komponenten und Screens
worker            Cloudflare Worker
docs              Architektur, Engine, KI-Proxy
scripts           Icons, Rauchtest
```

## Bekannte Einschränkungen

- **Aufstehzeit**: Die App kennt nur die übliche Aufstehzeit aus den Einstellungen, keine tägliche.
  Die Zeile „Aufgestanden“ in der Timeline und der Bereich für die erste Zigarette beziehen sich darauf.
- **Tage ohne App**: Ein Tag ohne Einträge, an dem die App nicht geöffnet wurde, gilt als
  unbeobachtet und zählt nicht. Er lässt sich im Verlauf als rauchfrei bestätigen.
- **Einstellungen wirken rückwirkend**: Ausgangsniveau, Packungspreis und Schlafzeiten gelten für
  den gesamten Verlauf, nicht erst ab dem Änderungsdatum.
- **Insight „in Gesellschaft“**: Die App kennt keine Aufenthaltsdauern. Statt eines Faktors
  („1,7× häufiger“) nennt sie den Anteil der markierten Zigaretten.
- **Datei-Export auf iOS**: läuft über den Teilen-Dialog („In Dateien sichern“).
- **Startbilder**: für gängige iPhone-Größen ab iPhone X hinterlegt; auf anderen Geräten zeigt iOS
  beim Start kurz die Hintergrundfarbe.
- **Sommerzeit-Umstellung**: Am Umstellungstag kann die Tagesgrenze um bis zu eine Stunde abweichen.
- **Kein Medizinprodukt**: Die App ersetzt keine medizinische Beratung.
- Getestet im emulierten iPhone-Viewport (Chromium). Ein Test auf einem echten iPhone im
  Standalone-Modus steht noch aus.

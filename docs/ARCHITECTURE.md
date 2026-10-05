# Architektur

Ausklang ist eine local-first PWA für genau einen Nutzer. Es gibt kein Backend für Nutzerdaten:
Alle Rohdaten liegen in IndexedDB auf dem Gerät. Der einzige Servercode ist ein optionaler,
zustandsloser KI-Proxy.

## Schichten

```
src/
  domain/        Typen, Zeitmodell, Standardwerte, Formatierung        (keine Abhängigkeiten)
  engine/        Reduction Engine – pure Funktionen                    (nur domain)
  analytics/     Kennzahlen, Insights, lokaler Coach                   (domain + engine)
  persistence/   Dexie/IndexedDB, Repository, Backup, Demo-Daten       (domain)
  ai/            Abstrakte KI-Schicht (Interface + Proxy-Client)       (analytics-Typen)
  state/         React-Hooks: verbinden persistence → engine           (alles darunter)
  ui/            Komponenten und Screens                               (alles darunter)
worker/          Cloudflare Worker: statische Assets + /api/coach
scripts/         Icon-Generator, End-to-End-Rauchtest
```

Abhängigkeiten zeigen nur nach oben in dieser Liste. `domain`, `engine` und `analytics` importieren
weder React noch Dexie und sind ohne Browser testbar.

## Datenfluss

```
IndexedDB ──useLiveQuery──▶ useAppData ──buildModel()──▶ AppModel ──▶ Screens
    ▲                                                        │
    └────────── repo.ts (add/update/delete) ◀── Nutzeraktion ┘
```

1. `state/useAppData.ts` liest Einstellungen, Zigaretten, Verlangen und Tagesmarkierungen live.
2. `engine/model.ts → buildModel()` leitet daraus den gesamten Zustand ab: Tagesdatensätze,
   Ziel, Status, erste Zigarette, vermiedene Zigaretten, Prognose.
3. Screens rendern nur `AppModel`. Sie enthalten keine Geschäftslogik.
4. Aktionen schreiben über `persistence/repo.ts`. Die Live-Query löst die Neuberechnung aus.

Es gibt keinen globalen Store. Die Datenbank ist die einzige Quelle der Wahrheit; UI-Zustand
(welches Sheet offen ist) liegt lokal in `App.tsx`.

## Datenmodell (IndexedDB `ausklang`, Schema-Version 1)

| Tabelle | Schlüssel | Art | Inhalt |
| --- | --- | --- | --- |
| `settings` | `id` (`'main'`) | Rohdaten | Ausgangsniveau, Packung, Schlafzeiten, Zielkorridor, Planstart, Erscheinungsbild, Coach |
| `cigarettes` | `id`, Index `timestamp` | Rohdaten | `cigaretteEvent` |
| `cravings` | `id`, Index `startTimestamp`, `outcome` | Rohdaten | `cravingEvent` |
| `dayMarks` | `date` | Rohdaten | Tag wurde beobachtet (`opened`) oder als rauchfrei bestätigt (`confirmed`) |
| `dailyPlans` | `date` | abgeleitet | Schnappschuss der Engine je Tag |
| `dailySummaries` | `date` | abgeleitet | Schnappschuss der Tageswerte |

Typen: `src/domain/types.ts`. `dailyPlans` und `dailySummaries` werden bei jeder Änderung neu
geschrieben und beim Import nicht übernommen, sondern neu berechnet. Sie existieren für Export
und Fehlersuche.

**Migrationen**: In `persistence/db.ts` eine neue `this.version(n).stores(...).upgrade(...)`
ergänzen und `SCHEMA_VERSION` in `domain/types.ts` erhöhen. Bestehende Versionen nie ändern.
`persistence/backup.ts → validateBackup` lehnt Backups mit höherer Version ab.

## UI

- `App.tsx`: Start, Onboarding-Weiche, Shell mit Kopfzeile, Tab-Leiste, Sheets und Undo-Toast.
- `ui/screens/`: `TodayScreen` (+ `TodayDock`), `HistoryScreen` (Kalender, Liste, Tagesdetail,
  Bearbeiten), `InsightsScreen`, `CoachScreen`, `SettingsSheet`, `Onboarding`, `HelpMode`,
  `flows.tsx` (Sheets nach „Zigarette“, „Verlangen“, „Verlangen vorbei“).
- `ui/components/`: `Sheet` (Bottom Sheet mit Ziehen), `controls` (Buttons, Chips, Skala, Status),
  `charts` (SVG-Charts ohne Bibliothek), `Icon`.
- Styling: Tailwind v4 plus Design-Tokens als CSS-Variablen in `src/index.css`. Hell/Dunkel über
  `data-theme` am `<html>`; gesetzt vor dem ersten Rendern in `index.html` und danach von
  `useAppearance`.

### UX-Regeln, die im Code verankert sind

- Der Heute-Screen zeigt nie das interne Ziel, nie verbleibende Zigaretten, nie einen Countdown.
- Status ist immer Farbe **und** Symbol **und** Text (`StatusBadge`).
- Rot wird nie mit Schuld-Sprache kombiniert (`STATUS_TEXT` in `TodayScreen.tsx`).
- Jede Zusatzangabe ist optional; „Überspringen“ ändert nichts am gespeicherten Eintrag.
- Die KI bekommt das interne Ziel nur als Hintergrund und darf es nicht nennen (System-Prompt im Worker).

## KI-Schicht

`ai/service.ts` definiert `AIService`. Ohne Konfiguration liefert `createAIService` einen
deaktivierten Dienst, und der Coach arbeitet rein lokal (`analytics/coach.ts`). Mit Konfiguration
schickt `ProxyAIService` Frage, verdichtete Kennzahlen (`buildCoachContext`) und die lokale
Antwort an den Proxy. Details: [AI-WORKER.md](AI-WORKER.md).

## PWA

- `vite-plugin-pwa` erzeugt Manifest und Service Worker (Workbox, `generateSW`, `autoUpdate`).
- Precache: App-Hülle und Icons. `/api/*` ist vom Navigations-Fallback ausgenommen.
- iOS: Meta-Tags und Startbilder in `index.html`, Icons und Startbilder aus
  `scripts/generate-icons.mjs` (`npm run icons`).
- `body` ist fixiert, gescrollt wird nur in `.scroll-area` – kein Pull-to-Refresh, kein Gummiband.

## Tests

- `npm test`: Unit-Tests der Engine (Vitest, Node-Umgebung).
- `npm run smoke`: End-to-End im iPhone-Viewport (390×844) gegen den Production-Build mit dem
  installierten Edge/Chrome: Onboarding, Eintragen, Verlangen, Hilfe-Modus, Bearbeiten, Löschen
  mit Undo, Import, Export, Hell/Dunkel, Offline. Screenshots in `scripts/.smoke/`.

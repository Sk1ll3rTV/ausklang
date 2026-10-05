# KI-Proxy (Cloudflare Worker)

Der Coach funktioniert vollständig ohne KI. Der Proxy ist eine optionale Ergänzung: Er formuliert
die regelbasierten Antworten aus und beantwortet frei gestellte Fragen.

Code: `worker/index.ts`. Derselbe Worker liefert auch die statische App aus (`wrangler.jsonc`),
der Proxy liegt deshalb auf demselben Origin unter `/api/coach` – ohne CORS.

## Schnittstelle

```
GET  /api/coach                      → { "configured": true | false }
POST /api/coach
     Authorization: Bearer <COACH_ACCESS_TOKEN>
     { "question": string, "context": object, "localAnswer": string | null }
                                     → { "answer": string }
```

Fehler kommen als `{ "error": code }` mit passendem Status (401 Zugangscode, 413 zu groß,
422 abgelehnt, 429 Limit, 502 Anbieter, 503 nicht eingerichtet). Die App fällt in jedem
Fehlerfall auf die lokale Antwort zurück.

## Secrets

| Name | Zweck |
| --- | --- |
| `ANTHROPIC_API_KEY` | API-Key des KI-Anbieters |
| `COACH_ACCESS_TOKEN` | Selbst gewählter Zugangscode. Ohne ihn antwortet der Proxy nicht. |
| `ALLOWED_ORIGIN` (optional, Variable) | Nur nötig, wenn App und Worker auf verschiedenen Domains liegen |

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put COACH_ACCESS_TOKEN
```

Lokal mit `wrangler dev`: Datei `.dev.vars` anlegen (steht in `.gitignore`):

```
ANTHROPIC_API_KEY=...
COACH_ACCESS_TOKEN=...
```

Im Repo und im Frontend-Bundle liegt nie ein Key. Der Zugangscode wird in der App unter
Einstellungen → Coach eingetragen, bleibt in der lokalen Datenbank und wird nicht mit exportiert.

Der Zugangscode ist nötig, weil die URL öffentlich erreichbar ist: Ohne ihn könnte jeder den
API-Key auf deine Kosten nutzen.

## Was gesendet wird

`analytics/coach.ts → buildCoachContext` baut den Kontext. Er enthält nur Kennzahlen:

- Ausgangsniveau, Plantag, heutige Menge, Status, Zielbereich, Prognose
- die letzten bis zu 14 Tage als Tageswerte (Menge, Ziel, Status, Uhrzeit der ersten Zigarette, Verlangen)
- Summen (vermieden, gespart), Prognose bis 0
- Stundenverteilung, Auslöser-Rangliste, Erfolgsquoten bei Verlangen, Strategien

Nicht gesendet werden: Freitext-Notizen, einzelne Zeitstempel von Zigaretten oder Verlangen,
Rohdaten-Listen, der Zugangscode im Body.

Selbst angelegte Auswahlwerte (eigener Trigger, eigener Ort, eigener Trick) erscheinen als
Kategorienamen in den Ranglisten.

## Speicherung

Der Worker speichert nichts und schreibt keine Inhalte in Logs. Die Anfrage geht an die API des
Anbieters; für die Aufbewahrung dort gelten dessen Bedingungen für das verwendete Konto.

## Modell

`worker/index.ts` nutzt das offizielle SDK (`@anthropic-ai/sdk`) mit `claude-opus-5-5`,
`output_config.effort: "low"` und `max_tokens: 4000`. Serverseitige Fallbacks sind aktiviert
(`fallbacks: "default"`, Beta-Header `server-side-fallback-2026-07-01`): Lehnt das Modell eine
Anfrage ab, versucht die API automatisch ein Ausweichmodell. Wer das nicht möchte, entfernt
`betas` und `fallbacks` und ruft `client.messages.create` statt `client.beta.messages.create` auf.

Die Anfrageform ist auf dieses Modell abgestimmt. Bei einem Modellwechsel prüfen, ob `effort`
und `fallbacks` dort unterstützt werden.

Der System-Prompt legt den Stil fest (ruhig, analytisch, nicht wertend) und verbietet, das interne
Tagesziel, verbleibende Zigaretten oder „erlaubte“ Uhrzeiten zu nennen.

## Getrennt betreiben

Die App kann auch woanders liegen (z. B. Cloudflare Pages) und einen separat deployten Worker
nutzen:

1. Worker deployen, `ALLOWED_ORIGIN` auf die App-Domain setzen.
2. In der App unter Einstellungen → Coach die Adresse `https://<worker>/api/coach` eintragen,
   oder beim Build `VITE_AI_PROXY_URL` setzen.

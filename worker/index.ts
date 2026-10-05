/**
 * Cloudflare Worker: liefert die PWA (statische Assets aus ./dist) und stellt optional den
 * KI-Proxy für den Coach bereit.
 *
 *   POST /api/coach   { question, context, localAnswer }  →  { answer }
 *   GET  /api/coach   →  { configured: boolean }
 *
 * Secrets (niemals im Repo):
 *   ANTHROPIC_API_KEY    – API-Key des KI-Anbieters
 *   COACH_ACCESS_TOKEN   – persönlicher Zugangscode, den der Nutzer in der App einträgt
 *
 * Der Worker speichert nichts und protokolliert keine Inhalte. Details: docs/AI-WORKER.md
 */
import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  COACH_ACCESS_TOKEN?: string;
  /** Optional: erlaubter Origin, falls die App auf einer anderen Domain liegt als der Worker. */
  ALLOWED_ORIGIN?: string;
}

/** Die Anfrageform unten (effort, fallbacks) ist auf dieses Modell abgestimmt. */
const MODEL = 'claude-opus-5-5';
const MAX_BODY_BYTES = 48_000;
const MAX_QUESTION_CHARS = 600;

const SYSTEM_PROMPT = `Du bist der Coach in einer privaten App, mit der eine Person ihren Zigarettenkonsum schrittweise auf null reduziert.

Du bekommst eine Frage, verdichtete Kennzahlen aus der App (JSON) und – falls vorhanden – die regelbasierte Antwort der App als Faktenbasis.

Stil: ruhig, analytisch, freundlich, direkt, nicht wertend. Keine Ausrufezeichen, keine Emojis, kein Lob-Überschwang, keine Schuldzuweisungen. Ein schwieriger Tag ist eine Beobachtung, kein Versagen.

Inhalt:
- Antworte auf Deutsch in zwei bis fünf Sätzen Fließtext, ohne Überschriften oder Listen.
- Stütze jede Aussage auf die gelieferten Zahlen. Erfinde keine Werte und keine Muster. Wenn die Daten für eine Aussage nicht reichen, sag das knapp.
- Nenne keine Uhrzeit, ab der geraucht werden „darf“, und keine verbleibende Zigarettenzahl. Die App lenkt die Aufmerksamkeit bewusst weg von der nächsten Zigarette.
- Das interne Tagesziel (targetRange) ist nur Hintergrund für dich. Nenne es nicht als Zahl; sprich höchstens von „deinem Bereich“.
- Keine medizinischen Diagnosen oder Medikamentenempfehlungen. Bei Fragen zu Beschwerden verweise kurz auf medizinisches Fachpersonal.`;

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Vergleich über Hashes gleicher Länge, damit die Laufzeit nichts über den Code verrät. */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

async function handleCoach(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const configured = Boolean(env.ANTHROPIC_API_KEY && env.COACH_ACCESS_TOKEN);
  if (request.method === 'GET') return json({ configured }, 200, cors);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  if (!configured) return json({ error: 'not_configured' }, 503, cors);

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await tokenMatches(token, env.COACH_ACCESS_TOKEN!))) {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
  let body: { question?: unknown; context?: unknown; localAnswer?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_CHARS || typeof body.context !== 'object' || !body.context) {
    return json({ error: 'invalid_request' }, 400, cors);
  }
  const localAnswer = typeof body.localAnswer === 'string' ? body.localAnswer : null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Kurze Gesprächsantworten: niedrige Stufe genügt (Standard wäre „medium“).
      output_config: { effort: 'low' },
      // Lehnt das Modell eine Anfrage ab, versucht die API automatisch ein Ausweichmodell.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `Kennzahlen aus der App:\n${JSON.stringify(body.context)}`,
            localAnswer ? `Regelbasierte Antwort der App:\n${localAnswer}` : null,
            `Frage:\n${question}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });

    if (message.stop_reason === 'refusal') return json({ error: 'declined' }, 422, cors);
    const answer = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (!answer) return json({ error: 'empty_answer' }, 502, cors);
    return json({ answer }, 200, cors);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'provider_auth' }, 502, cors);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'rate_limited' }, 429, cors);
    if (error instanceof Anthropic.APIError) return json({ error: 'provider_error' }, 502, cors);
    return json({ error: 'unavailable' }, 502, cors);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/coach') return handleCoach(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404, {});
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

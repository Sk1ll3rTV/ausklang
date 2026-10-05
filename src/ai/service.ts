import type { CoachContext } from '../analytics/coach';
import type { CoachSettings } from '../domain/types';

/**
 * Abstrakte KI-Schicht. Die App kennt nur dieses Interface – der Anbieter steckt hinter einem
 * Proxy (siehe worker/index.ts). Im Frontend liegt nie ein API-Key.
 */
export interface AIRequest {
  question: string;
  /** Verdichtete Kennzahlen, keine Rohdaten. */
  context: CoachContext;
  /** Deterministische lokale Antwort als Faktenbasis. */
  localAnswer: string | null;
}

export interface AIService {
  readonly configured: boolean;
  ask(request: AIRequest, signal?: AbortSignal): Promise<string>;
}

export class AIServiceError extends Error {}

export function resolveEndpoint(coach: CoachSettings): string {
  return coach.endpoint.trim() || import.meta.env.VITE_AI_PROXY_URL || '/api/coach';
}

class DisabledAIService implements AIService {
  readonly configured = false;
  async ask(): Promise<string> {
    throw new AIServiceError('Die KI-Ergänzung ist nicht eingerichtet.');
  }
}

class ProxyAIService implements AIService {
  readonly configured = true;
  constructor(
    private endpoint: string,
    private token: string,
  ) {}

  async ask(request: AIRequest, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify(request),
        signal,
      });
    } catch {
      throw new AIServiceError('Der KI-Dienst ist gerade nicht erreichbar.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new AIServiceError('Der Zugangscode wurde nicht akzeptiert.');
    }
    if (response.status === 429) throw new AIServiceError('Der KI-Dienst ist gerade ausgelastet.');
    if (!response.ok) throw new AIServiceError('Der KI-Dienst hat nicht geantwortet.');
    const data = (await response.json().catch(() => null)) as { answer?: unknown } | null;
    if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
      throw new AIServiceError('Der KI-Dienst hat keine verwertbare Antwort geliefert.');
    }
    return data.answer.trim();
  }
}

export function createAIService(coach: CoachSettings): AIService {
  if (!coach.aiEnabled || !coach.accessToken.trim()) return new DisabledAIService();
  return new ProxyAIService(resolveEndpoint(coach), coach.accessToken.trim());
}

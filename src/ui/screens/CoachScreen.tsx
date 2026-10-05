import { useEffect, useMemo, useRef, useState } from 'react';
import { AIServiceError, createAIService } from '../../ai/service';
import {
  QUESTIONS,
  answerQuestion,
  buildCoachContext,
  dailyBriefing,
  matchQuestion,
  type QuestionId,
} from '../../analytics/coach';
import type { Settings } from '../../domain/types';
import type { AppModel } from '../../engine/model';
import { Card } from '../components/controls';
import { Icon } from '../components/Icon';

interface Exchange {
  id: number;
  question: string;
  /** Regelbasierte Antwort – sofort und offline verfügbar. */
  local: string | null;
  ai: { state: 'loading' } | { state: 'done'; text: string } | { state: 'error'; text: string } | null;
}

const UNKNOWN =
  'Diese Frage kann ich ohne KI-Ergänzung nicht frei beantworten. Die Fragen unten decken ab, was sich aus deinen Daten sicher ablesen lässt.';

export function CoachScreen({ model, settings }: { model: AppModel; settings: Settings }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(1);
  const lastRef = useRef<HTMLDivElement>(null);
  const ai = useMemo(() => createAIService(settings.coach), [settings.coach]);
  const briefing = useMemo(() => dailyBriefing(model, settings), [model, settings]);

  useEffect(() => {
    if (exchanges.length) lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [exchanges]);

  const ask = (question: string, known?: QuestionId) => {
    const text = question.trim();
    if (!text) return;
    const matched = known ?? matchQuestion(text);
    const local = matched ? answerQuestion(matched, model, settings) : null;
    const id = nextId.current++;
    const online = ai.configured && navigator.onLine;
    setExchanges((list) => [
      ...list,
      { id, question: text, local: local ?? (online ? null : UNKNOWN), ai: online ? { state: 'loading' } : null },
    ]);
    setDraft('');
    if (!online) return;

    const update = (result: Exchange['ai'], fallback?: string) =>
      setExchanges((list) =>
        list.map((e) => (e.id === id ? { ...e, ai: result, local: e.local ?? fallback ?? null } : e)),
      );
    ai.ask({ question: text, context: buildCoachContext(model, settings), localAnswer: local })
      .then((answer) => update({ state: 'done', text: answer }))
      .catch((error: unknown) =>
        update(
          {
            state: 'error',
            text: error instanceof AIServiceError ? error.message : 'Die KI-Ergänzung war nicht erreichbar.',
          },
          UNKNOWN,
        ),
      );
  };

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink3">Heute</p>
        <p className="mt-1.5 text-[17px] leading-snug">{briefing}</p>
      </Card>

      {exchanges.map((e, i) => (
        <div key={e.id} ref={i === exchanges.length - 1 ? lastRef : undefined} className="fade-up scroll-mt-2 space-y-2">
          <div className="ml-auto w-fit max-w-[85%] rounded-[22px] rounded-br-lg bg-solid px-4 py-2.5 text-[16px] leading-snug text-on-solid">
            {e.question}
          </div>
          <Card className="mr-6 rounded-bl-lg">
            {e.local && e.ai?.state !== 'done' && <p className="text-[16px] leading-snug">{e.local}</p>}
            {e.ai?.state === 'done' && <p className="whitespace-pre-line text-[16px] leading-snug">{e.ai.text}</p>}
            {e.ai?.state === 'loading' && (
              <p className={`text-[13px] text-ink3 ${e.local ? 'mt-2' : ''}`} role="status">
                KI-Einordnung wird geladen …
              </p>
            )}
            {e.ai?.state === 'error' && <p className="mt-2 text-[13px] text-ink3">{e.ai.text} Lokale Antwort oben.</p>}
            {e.ai?.state === 'done' && <p className="mt-2 text-[12px] text-ink3">Mit KI formuliert, auf Basis deiner Kennzahlen.</p>}
          </Card>
        </div>
      ))}

      <div>
        <p className="px-1 pb-2 text-[13px] font-medium uppercase tracking-wide text-ink2">Fragen</p>
        <ul className="glass overflow-hidden rounded-[26px]">
          {QUESTIONS.map((q, i) => (
            <li key={q.id} className={i ? 'border-t-[0.5px] border-sep' : ''}>
              <button
                type="button"
                onClick={() => ask(q.label, q.id)}
                className="flex min-h-[50px] w-full items-center gap-3 px-4 py-2 text-left text-[16px] active:bg-fill"
              >
                <span className="flex-1">{q.label}</span>
                <span className="text-ink3">
                  <Icon name="chevronRight" size={15} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="glass-strong flex items-center gap-1 rounded-full py-1 pl-5 pr-1.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          maxLength={300}
          placeholder="Eigene Frage"
          aria-label="Eigene Frage an den Coach"
          enterKeyHint="send"
          className="min-h-[44px] min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink3"
        />
        <button
          type="submit"
          aria-label="Frage senden"
          disabled={!draft.trim()}
          className="pressable flex size-10 items-center justify-center rounded-full bg-solid text-on-solid disabled:opacity-30"
        >
          <Icon name="send" size={18} strokeWidth={2.2} />
        </button>
      </form>
      <p className="px-2 text-[12px] leading-snug text-ink3">
        {ai.configured
          ? 'Die Antworten entstehen lokal aus deinen Daten. Die KI formuliert sie aus und erhält dafür nur verdichtete Kennzahlen.'
          : 'Alle Antworten entstehen lokal auf deinem Gerät aus deinen Einträgen.'}
      </p>
    </div>
  );
}

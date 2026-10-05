import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { bestCopingStrategy } from './analytics/stats';
import { dayLabel } from './domain/format';
import { HOUR, MIN } from './domain/time';
import type { CigaretteEvent, CravingEvent } from './domain/types';
import { requestPersistentStorage } from './persistence/db';
import { importPersonalDataFromHash } from './persistence/personalImport';
import { addCigarette, loadSettings, resolveCraving } from './persistence/repo';
import { useAppData, useAppearance, type AppData } from './state/useAppData';
import { IconButton } from './ui/components/controls';
import { Icon, type IconName } from './ui/components/Icon';
import { CoachScreen } from './ui/screens/CoachScreen';
import { CigaretteDetailsSheet, CravingDoneSheet, CravingSheet } from './ui/screens/flows';
import { HelpMode } from './ui/screens/HelpMode';
import { HistoryScreen } from './ui/screens/HistoryScreen';
import { InsightsScreen } from './ui/screens/InsightsScreen';
import { Onboarding } from './ui/screens/Onboarding';
import { SettingsSheet } from './ui/screens/SettingsSheet';
import { TodayDock, TodayScreen } from './ui/screens/TodayScreen';

type Tab = 'today' | 'history' | 'insights' | 'coach';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Heute', icon: 'today' },
  { id: 'history', label: 'Verlauf', icon: 'history' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'coach', label: 'Coach', icon: 'coach' },
];

export default function App() {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void (async () => {
      await importPersonalDataFromHash();
      await loadSettings();
      setBooted(true);
    })();
    void requestPersistentStorage();
  }, []);

  const data = useAppData(booted);
  useAppearance(data?.settings.appearance);

  // Bis die lokale Datenbank geladen ist, bleibt nur der ruhige Hintergrund sichtbar.
  if (!data) return null;
  if (!data.settings.onboarded) return <Onboarding settings={data.settings} />;
  return <Shell data={data} />;
}

/** Kürzliches Verlangen, zu dem eine gerade eingetragene Zigarette gehören könnte. */
function findRelatedCraving(cravings: CravingEvent[], now: number): CravingEvent | null {
  const recent = [...cravings].sort((a, b) => b.startTimestamp - a.startTimestamp);
  return (
    recent.find((c) => c.outcome === 'active' && now - c.startTimestamp < 3 * HOUR) ??
    recent.find((c) => c.outcome === 'passed' && c.endTimestamp !== undefined && now - c.endTimestamp < 30 * MIN) ??
    null
  );
}

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

function Shell({ data }: { data: AppData }) {
  const { settings, model, cravings } = data;
  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cravingOpen, setCravingOpen] = useState(false);
  const [logged, setLogged] = useState<{ event: CigaretteEvent; related: CravingEvent | null } | null>(null);
  const [doneCraving, setDoneCraving] = useState<CravingEvent | null>(null);
  const [helpCraving, setHelpCraving] = useState<CravingEvent | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((text: string, undo?: () => void) => {
    setToast({ id: Date.now(), text, undo });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const logCigarette = async () => {
    const related = findRelatedCraving(cravings, Date.now());
    const event = await addCigarette();
    if (settings.askDetailsAfterCigarette || related) setLogged({ event, related });
  };

  const cravingPassed = async (craving: CravingEvent) => {
    await resolveCraving(craving.id, 'passed');
    setDoneCraving({ ...craving, outcome: 'passed' });
  };

  const title = TABS.find((t) => t.id === tab)!.label;
  const dockSpace = tab === 'today' ? 150 : 0;

  return (
    <div className="relative flex h-full flex-col">
      <header
        className="flex shrink-0 items-end justify-between px-5 pb-2"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 6px)' }}
      >
        <div>
          <p className="h-[18px] text-[13px] font-semibold uppercase tracking-wide text-ink2">
            {tab === 'today' ? dayLabel(model.todayKey) : ''}
          </p>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight">{title}</h1>
        </div>
        <IconButton icon="gear" label="Einstellungen" onClick={() => setSettingsOpen(true)} />
      </header>

      <main
        key={tab}
        className="scroll-area fade-in min-h-0 flex-1 px-4 pt-1"
        style={{ paddingBottom: `calc(max(env(safe-area-inset-bottom), 12px) + ${96 + dockSpace}px)` }}
      >
        {tab === 'today' && (
          <TodayScreen model={model} onCravingPassed={(c) => void cravingPassed(c)} onHelp={setHelpCraving} />
        )}
        {tab === 'history' && <HistoryScreen model={model} settings={settings} notify={notify} />}
        {tab === 'insights' && <InsightsScreen model={model} settings={settings} />}
        {tab === 'coach' && <CoachScreen model={model} settings={settings} />}
      </main>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 px-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        {tab === 'today' && (
          <div className="pointer-events-auto relative pb-3">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-4 -top-8 bottom-[-120px] -z-10"
              style={{ background: 'linear-gradient(to top, var(--bg) 55%, transparent)' }}
            />
            <TodayDock onCigarette={() => void logCigarette()} onCraving={() => setCravingOpen(true)} />
          </div>
        )}
        <nav aria-label="Hauptnavigation" className="glass-strong pointer-events-auto flex h-[66px] items-stretch rounded-full p-1.5">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-colors duration-300 ${active ? 'bg-fill text-accent' : 'text-ink2'}`}
              >
                <Icon name={t.icon} size={23} strokeWidth={active ? 2.1 : 1.8} />
                <span className="text-[10.5px] font-medium">{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <CigaretteDetailsSheet
        event={logged?.event ?? null}
        relatedCraving={logged?.related ?? null}
        settings={settings}
        onClose={() => setLogged(null)}
      />
      <CravingSheet open={cravingOpen} settings={settings} onClose={() => setCravingOpen(false)} onHelp={setHelpCraving} />
      <CravingDoneSheet craving={doneCraving} settings={settings} onClose={() => setDoneCraving(null)} />
      <HelpMode craving={helpCraving} personal={bestCopingStrategy(model)} onClose={() => setHelpCraving(null)} />
      <SettingsSheet open={settingsOpen} settings={settings} model={model} onClose={() => setSettingsOpen(false)} notify={notify} />

      {toast &&
        createPortal(
          <div
            key={toast.id}
            role="status"
            className="fade-up pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
            style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 12px) + 84px)' }}
          >
            <div className="glass-strong pointer-events-auto flex min-h-[48px] items-center gap-3 rounded-full py-1 pl-5 pr-2 text-[15px]">
              <span>{toast.text}</span>
              {toast.undo ? (
                <button
                  type="button"
                  className="min-h-[40px] rounded-full px-3 font-semibold text-accent"
                  onClick={() => {
                    toast.undo?.();
                    setToast(null);
                  }}
                >
                  Rückgängig
                </button>
              ) : (
                <span className="w-3" />
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

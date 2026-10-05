import { useRef, useState, type ReactNode } from 'react';
import { resolveEndpoint } from '../../ai/service';
import { euro } from '../../domain/format';
import type { Appearance, Settings } from '../../domain/types';
import type { AppModel } from '../../engine/model';
import {
  backupToCSV,
  createBackup,
  deliverFile,
  importBackup,
  validateBackup,
  type ValidationResult,
} from '../../persistence/backup';
import { saveSettings, wipeAllData } from '../../persistence/repo';
import { Button, SectionLabel, Segmented } from '../components/controls';
import { Icon } from '../components/Icon';
import { Sheet, SheetAction } from '../components/Sheet';
import type { Notify } from './HistoryScreen';

export const MEDICAL_NOTE =
  'Diese App ersetzt keine medizinische Beratung. Bei starken Beschwerden oder wenn du Unterstützung beim Rauchstopp möchtest, wende dich an medizinisches Fachpersonal.';

export function SettingsSheet({
  open,
  settings,
  model,
  onClose,
  notify,
}: {
  open: boolean;
  settings: Settings;
  model: AppModel;
  onClose: () => void;
  notify: Notify;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<Extract<ValidationResult, { ok: true }> | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const save = (patch: Partial<Settings>) => void saveSettings(patch);
  const stamp = new Date().toISOString().slice(0, 10);

  const derived = () => ({
    dailyPlans: model.days.map((d) => d.plan),
    dailySummaries: model.days.map((d) => d.summary),
  });
  const exportJSON = async () => {
    const backup = await createBackup(derived());
    await deliverFile(`ausklang-backup-${stamp}.json`, JSON.stringify(backup, null, 2), 'application/json');
  };
  const exportCSV = async () => {
    const backup = await createBackup();
    await deliverFile(`ausklang-eintraege-${stamp}.csv`, backupToCSV(backup), 'text/csv');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportErrors(['Die Datei konnte nicht gelesen werden. Erwartet wird ein JSON-Backup dieser App.']);
      return;
    }
    const result = validateBackup(parsed);
    if (result.ok) setPendingImport(result);
    else setImportErrors(result.errors);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="Einstellungen"
      trailing={
        <SheetAction strong onClick={onClose}>
          Fertig
        </SheetAction>
      }
    >
      <div className="space-y-6 pt-2">
        <Group label="Ausgangsniveau" footer="Grundlage dafür, was als vermieden zählt. Eine Änderung wirkt auf den gesamten Verlauf.">
          <Row label="Zigaretten pro Tag">
            <Stepper
              label="Zigaretten pro Tag"
              value={settings.baselineCigarettesPerDay}
              min={1}
              max={80}
              onChange={(v) => save({ baselineCigarettesPerDay: v })}
            />
          </Row>
        </Group>

        <Group label="Packung" footer={`Entspricht ${euro(settings.packPrice / settings.cigarettesPerPack)} pro Zigarette.`}>
          <Row label="Preis">
            <Stepper
              label="Packungspreis"
              value={settings.packPrice}
              min={1}
              max={60}
              step={0.5}
              format={euro}
              onChange={(v) => save({ packPrice: v })}
            />
          </Row>
          <Row label="Zigaretten pro Packung">
            <Stepper
              label="Zigaretten pro Packung"
              value={settings.cigarettesPerPack}
              min={1}
              max={60}
              onChange={(v) => save({ cigarettesPerPack: v })}
            />
          </Row>
        </Group>

        <Group label="Tagesrhythmus" footer="Während der Schlafzeit wächst der Zähler für vermiedene Zigaretten nicht.">
          <Row label="Typische Aufstehzeit">
            <TimeInput label="Typische Aufstehzeit" value={settings.usualWakeTime} onChange={(v) => save({ usualWakeTime: v })} />
          </Row>
          <Row label="Typische Schlafenszeit">
            <TimeInput label="Typische Schlafenszeit" value={settings.usualSleepTime} onChange={(v) => save({ usualSleepTime: v })} />
          </Row>
        </Group>

        <div>
          <SectionLabel>Erscheinungsbild</SectionLabel>
          <Segmented<Appearance>
            label="Erscheinungsbild"
            value={settings.appearance}
            onChange={(appearance) => save({ appearance })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Hell' },
              { value: 'dark', label: 'Dunkel' },
            ]}
          />
        </div>

        <Group label="Eintragen">
          <Row label="Nach Zigarette Details anbieten">
            <Switch
              label="Nach Zigarette Details anbieten"
              checked={settings.askDetailsAfterCigarette}
              onChange={(v) => save({ askDetailsAfterCigarette: v })}
            />
          </Row>
        </Group>

        <Group
          label="Coach"
          footer="Der Coach arbeitet vollständig lokal. Die KI-Ergänzung ist optional: Sie formuliert Antworten aus und erhält dafür nur verdichtete Kennzahlen – keine Notizen, keine einzelnen Zeitpunkte. Der Zugangscode gehört zu deinem eigenen Proxy und bleibt auf diesem Gerät."
        >
          <Row label="KI-Ergänzung">
            <Switch
              label="KI-Ergänzung"
              checked={settings.coach.aiEnabled}
              onChange={(aiEnabled) => save({ coach: { ...settings.coach, aiEnabled } })}
            />
          </Row>
          {settings.coach.aiEnabled && (
            <>
              <TextRow
                label="Zugangscode"
                type="password"
                value={settings.coach.accessToken}
                placeholder="erforderlich"
                onChange={(accessToken) => save({ coach: { ...settings.coach, accessToken } })}
              />
              <TextRow
                label="Adresse"
                type="url"
                value={settings.coach.endpoint}
                placeholder={resolveEndpoint({ ...settings.coach, endpoint: '' })}
                onChange={(endpoint) => save({ coach: { ...settings.coach, endpoint } })}
              />
            </>
          )}
        </Group>

        <Group label="Daten" footer="Alle Einträge liegen ausschließlich auf diesem Gerät. Ein Backup schützt vor Verlust.">
          <ActionRow label="Daten exportieren (JSON)" onClick={() => void exportJSON()} />
          <ActionRow label="Einträge exportieren (CSV)" onClick={() => void exportCSV()} />
          <ActionRow label="Backup importieren" onClick={() => fileInput.current?.click()} />
          <ActionRow label="Alle Daten löschen" danger onClick={() => setConfirmWipe(true)} />
        </Group>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {import.meta.env.DEV && (
          <Group label="Entwicklung" footer="Nur im Entwicklungsmodus sichtbar.">
            <ActionRow
              label="Demo-Daten laden"
              onClick={() => void import('../../persistence/demo').then((m) => m.loadDemoData()).then(() => notify('Demo-Daten geladen'))}
            />
          </Group>
        )}

        <div className="space-y-2 px-1 pb-2 text-[13px] leading-snug text-ink3">
          <p>{MEDICAL_NOTE}</p>
          <p>Ausklang · Version {__APP_VERSION__}</p>
        </div>
      </div>

      <Sheet open={pendingImport !== null} onClose={() => setPendingImport(null)} title="Backup importieren">
        <p className="pt-1 text-center text-[16px] leading-snug text-ink2">
          Das Backup enthält {pendingImport?.counts.cigarettes ?? 0} Zigaretten und {pendingImport?.counts.cravings ?? 0}{' '}
          Verlangen. Der Import ersetzt alle Daten auf diesem Gerät. Das lässt sich nicht rückgängig machen.
        </p>
        <div className="mt-5 space-y-2.5">
          <Button
            variant="danger"
            onClick={() => {
              const p = pendingImport;
              setPendingImport(null);
              if (p) void importBackup(p.backup).then(() => notify('Backup importiert'));
            }}
          >
            Daten ersetzen
          </Button>
          <Button onClick={() => setPendingImport(null)}>Abbrechen</Button>
        </div>
      </Sheet>

      <Sheet open={importErrors !== null} onClose={() => setImportErrors(null)} title="Import nicht möglich">
        <ul className="space-y-1.5 pt-1 text-[16px] leading-snug text-ink2">
          {(importErrors ?? []).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="mt-3 text-[14px] text-ink3">Deine vorhandenen Daten wurden nicht verändert.</p>
        <div className="mt-5">
          <Button onClick={() => setImportErrors(null)}>OK</Button>
        </div>
      </Sheet>

      <Sheet open={confirmWipe} onClose={() => setConfirmWipe(false)} title="Alle Daten löschen?">
        <p className="pt-1 text-center text-[16px] leading-snug text-ink2">
          Alle Einträge, der Verlauf und die Einstellungen werden von diesem Gerät entfernt. Das lässt sich nicht
          rückgängig machen.
        </p>
        <div className="mt-5 space-y-2.5">
          <Button
            variant="danger"
            onClick={() => {
              setConfirmWipe(false);
              onClose();
              void wipeAllData().then(() => window.location.reload());
            }}
          >
            Endgültig löschen
          </Button>
          <Button onClick={() => setConfirmWipe(false)}>Abbrechen</Button>
        </div>
      </Sheet>
    </Sheet>
  );
}

// --- Bausteine ---------------------------------------------------------------------

function Group({ label, footer, children }: { label: string; footer?: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="divide-y-[0.5px] divide-[var(--sep)] overflow-hidden rounded-[22px] bg-fill">{children}</div>
      {footer && <p className="px-1 pt-2 text-[13px] leading-snug text-ink3">{footer}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-1.5 text-[16px]">
      <span>{label}</span>
      {children}
    </div>
  );
}

function ActionRow({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center px-4 text-left text-[16px] active:bg-fill ${danger ? 'text-alert' : 'text-accent'}`}
    >
      {label}
    </button>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type: 'password' | 'url';
}) {
  return (
    <label className="flex min-h-[52px] items-center gap-3 px-4 text-[16px]">
      <span className="shrink-0">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-right text-ink outline-none placeholder:text-ink3"
      />
    </label>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} verringern`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="pressable flex size-11 items-center justify-center rounded-full bg-fill text-[22px] leading-none disabled:opacity-30"
      >
        −
      </button>
      <span className="num min-w-[4.2ch] text-center text-[17px] font-semibold" aria-live="polite">
        {format(value)}
      </span>
      <button
        type="button"
        aria-label={`${label} erhöhen`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className="pressable flex size-11 items-center justify-center rounded-full bg-fill text-accent disabled:opacity-30"
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

export function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="num min-h-[40px] rounded-xl bg-fill px-3 text-ink outline-none"
    />
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative flex h-11 w-[52px] shrink-0 items-center"
    >
      <span
        className="block h-[31px] w-[51px] rounded-full transition-colors duration-300"
        style={{ background: checked ? 'var(--ok)' : 'var(--fill2)' }}
      />
      <span
        className="absolute left-[2px] size-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-transform duration-500"
        style={{ transform: `translateX(${checked ? 20 : 0}px)`, transitionTimingFunction: 'var(--spring)' }}
      />
    </button>
  );
}

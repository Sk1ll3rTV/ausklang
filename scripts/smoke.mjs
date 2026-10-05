// End-to-End-Rauchtest im iPhone-Viewport gegen den Production-Build.
// Voraussetzung: `npm run build`. Nutzt den installierten Browser (Edge oder Chrome), kein Download.
// Aufruf: npm run smoke   → Screenshots in scripts/.smoke/
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, '.smoke');
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` – ${detail}` : ''}`);
};

/** Backup mit zehn Tagen Verlauf – testet zugleich den Import. */
function makeBackup() {
  const now = Date.now();
  const d = new Date(now);
  const day = (offset, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, h, m).getTime();
  const key = (offset) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const counts = [18, 17, 16, 14, 14, 12, 15, 10, 9, 8];
  const triggers = ['Kaffee', 'Stress', 'Autofahren', 'nach dem Essen', 'Gewohnheit'];
  const cigarettes = [];
  const cravings = [];
  const dayMarks = [];
  let id = 0;
  counts.forEach((n, i) => {
    const offset = i - counts.length;
    dayMarks.push({ date: key(offset), source: 'opened' });
    for (let k = 0; k < n; k++) {
      const ts = day(offset, 7, 30 + i * 6) + (k * 15.5 * 3600_000) / n;
      cigarettes.push({
        id: `t-c${id++}`,
        timestamp: ts,
        createdAt: ts,
        updatedAt: ts,
        ...(k % 2 ? { trigger: triggers[(k + i) % triggers.length], companions: k % 4 === 1 ? 'allein' : 'Kollegen' } : {}),
      });
    }
    for (let k = 0; k < 2; k++) {
      const start = day(offset, 10 + k * 5, 12);
      cravings.push({
        id: `t-v${id++}`,
        startTimestamp: start,
        endTimestamp: start + 7 * 60_000,
        intensityInitial: k ? 8 : 5,
        outcome: (i + k) % 3 === 0 ? 'smoked' : 'passed',
        trigger: triggers[(i + k) % triggers.length],
        location: k ? 'Auto' : 'Arbeit',
        copingStrategy: k ? 'Atmen' : 'Wasser trinken',
        createdAt: start,
        updatedAt: start,
      });
    }
  });
  return {
    app: 'ausklang',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      id: 'main',
      schemaVersion: 1,
      onboarded: true,
      baselineCigarettesPerDay: 20,
      baselineFirstCigaretteDelayMin: 20,
      packPrice: 12,
      cigarettesPerPack: 28,
      usualWakeTime: '07:00',
      usualSleepTime: '00:00',
      cessationTargetMinDays: 14,
      cessationTargetMaxDays: 21,
      currentPlanStartDate: key(-counts.length),
      planStartedAt: day(-counts.length, 7),
      appearance: 'system',
      askDetailsAfterCigarette: true,
      coach: { aiEnabled: false, endpoint: '', accessToken: '' },
      customOptions: { trigger: [], mood: [], location: [], activity: [], companions: [], coping: [] },
    },
    cigarettes,
    cravings,
    dayMarks,
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Preview-Server nicht erreichbar');
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // nächsten Browser versuchen
    }
  }
  throw new Error('Weder Edge noch Chrome gefunden.');
}

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});

let browser;
try {
  await waitForServer();
  browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    colorScheme: 'light',
    acceptDownloads: true,
  });
  // Im Test immer klassischer Download statt System-Teilen-Dialog.
  await context.addInitScript(() => {
    navigator.canShare = undefined;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
  const button = (name, exact = true) => page.getByRole('button', { name, exact });
  const count = async () => Number((await page.locator('section[aria-live] .num').first().innerText()).trim());
  const settle = (ms = 450) => page.waitForTimeout(ms);
  const tab = async (name) => {
    await page.getByRole('navigation').getByRole('button', { name }).click();
    await settle();
  };

  // --- Onboarding ---------------------------------------------------------------
  await page.goto(URL);
  await page.getByText('Wie viel rauchst du normalerweise?').waitFor();
  await shot('01-onboarding');
  for (let i = 0; i < 4; i++) {
    await button('Weiter').click();
    await settle(200);
  }
  await page.getByText('Langsam auf 0').waitFor();
  await shot('02-onboarding-ziel');
  await button('Starten').click();
  await page.getByRole('heading', { name: 'Heute' }).waitFor();
  await settle();
  check('Onboarding führt zum Heute-Screen', (await count()) === 0);
  check('Start ohne Demo-Werte (0 vermieden)', (await page.getByText('Seit Start vermieden').locator('..').locator('.num').innerText()) === '0');
  check('Status hat Text, nicht nur Farbe', await page.getByText('Im Plan').isVisible());
  await shot('03-heute-leer');

  // --- Zigarette eintragen ------------------------------------------------------
  await button('Zigarette').click();
  await page.getByText('Möchtest du etwas ergänzen?').waitFor();
  check('Ein Tap speichert sofort', (await count()) === 1);
  await button('Auslöser', false).click();
  await button('Kaffee').click();
  await settle(200);
  await shot('04-details-sheet');
  await button('Fertig').click();
  await settle();
  await button('Zigarette').click();
  await page.getByText('Möchtest du etwas ergänzen?').waitFor();
  await button('Überspringen').click();
  await settle();
  check('Überspringen behält den Eintrag', (await count()) === 2);

  // --- Starkes Verlangen + Hilfe ------------------------------------------------
  await button('Ich habe Verlangen').click();
  await page.getByText('Wie stark?').waitFor();
  await page.getByRole('radio', { name: '8', exact: true }).click();
  await shot('05-verlangen-sheet');
  await button('Sichern').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hilf mir kurz' }).click();
  await page.getByText('Das geht vorbei.').waitFor();
  await settle();
  await shot('06-hilfe-menue');
  await button('Atmen', false).click();
  await page.getByText('Folge dem Kreis.').waitFor();
  await settle(900);
  await shot('07-hilfe-atmen');
  await button('Weiter').click();
  await page.getByText('Wie ist es jetzt?').waitFor();
  await page.getByRole('radio', { name: '3', exact: true }).click();
  await shot('08-hilfe-nachfrage');
  await button('Vorbei').click();
  await settle();
  check('Starkes Verlangen über Hilfe-Modus beendet', !(await page.getByText('Verlangen läuft').isVisible()));

  // --- Verlangen erfolgreich beenden --------------------------------------------
  await button('Ich habe Verlangen').click();
  await page.getByRole('radio', { name: '5', exact: true }).click();
  await button('Sichern').first().click();
  await page.getByText('Verlangen läuft').waitFor();
  await shot('09-heute-verlangen-aktiv');
  await button('Verlangen vorbei').click();
  await page.getByText('Was hat geholfen?').waitFor();
  await button('Wasser trinken').click();
  await button('Fertig').click();
  await settle();
  check('Verlangen ist nicht mehr aktiv', !(await page.getByText('Verlangen läuft').isVisible()));

  // --- Zigarette nach Verlangen: optionale Zuordnung ----------------------------
  await button('Zigarette').click();
  await page.getByText('Möchtest du etwas ergänzen?').waitFor();
  check('Zuordnungsfrage nach kürzlichem Verlangen', await page.getByText('Gehörte diese Zigarette zum vorherigen Verlangen?').isVisible());
  await button('Eintrag rückgängig machen').click();
  await settle();
  check('Eintrag direkt rückgängig machbar', (await count()) === 2);

  // --- Neuladen: Daten bleiben --------------------------------------------------
  await page.reload();
  await page.getByRole('heading', { name: 'Heute' }).waitFor();
  await settle();
  check('Daten überstehen Neuladen', (await count()) === 2);

  // --- Verlauf: bearbeiten, löschen, Undo ---------------------------------------
  await tab('Verlauf');
  await shot('10-verlauf-kalender');
  await page.locator('button[aria-label*="2 Zigaretten"]').click();
  await page.getByText('Aufgestanden').waitFor();
  await settle();
  await shot('11-tagesdetail');
  check('Timeline zeigt überstandenes Verlangen', (await page.getByText('Verlangen vorbei').count()) === 2);
  await page.getByRole('listitem').filter({ hasText: /Zigarette/ }).first().getByRole('button').click();
  await page.getByText('Uhrzeit').waitFor();
  await button('Gefühlslage', false).click();
  await button('gestresst').click();
  await shot('12-bearbeiten');
  await button('Sichern').click();
  await settle();
  check('Bearbeiten speichert Kontext', await page.getByText('gestresst').first().isVisible());
  await page.getByRole('listitem').filter({ hasText: /Zigarette/ }).first().getByRole('button').click();
  await button('Löschen').click();
  await button('Rückgängig').waitFor();
  await shot('13-undo');
  check('Löschen berechnet Tageswert neu', await page.getByRole('dialog').getByText('Zigaretten').locator('..').getByText('1', { exact: true }).isVisible());
  await button('Rückgängig').click();
  await settle();
  check('Undo stellt den Eintrag wieder her', await page.getByRole('dialog').getByText('Zigaretten').locator('..').getByText('2', { exact: true }).isVisible());
  await button('Fertig').click();
  await settle();

  // --- Import -------------------------------------------------------------------
  const backupPath = join(out, 'import.json');
  writeFileSync(backupPath, JSON.stringify(makeBackup()));
  const bad = join(out, 'kaputt.json');
  writeFileSync(bad, JSON.stringify({ app: 'ausklang', schemaVersion: 1, settings: {}, cigarettes: 'x' }));
  await button('Einstellungen').click();
  await page.getByText('Ausgangsniveau').waitFor();
  await settle();
  await shot('14-einstellungen');
  await page.locator('input[type=file]').setInputFiles(bad);
  await page.getByText('Import nicht möglich').waitFor();
  check('Fehlerhaftes Backup wird abgelehnt', true);
  await button('OK').click();
  await settle();
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.getByText('Der Import ersetzt alle Daten').waitFor();
  await shot('15-import-warnung');
  check('Import warnt vor dem Überschreiben', true);
  await button('Daten ersetzen').click();
  await settle(800);

  // --- Export -------------------------------------------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), button('Daten exportieren (JSON)').click()]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check('Export enthält die importierten Einträge', exported.cigarettes.length === 133 && exported.cravings.length === 20, `${exported.cigarettes.length} Zigaretten`);
  check('Export enthält abgeleitete Tagespläne', Array.isArray(exported.dailyPlans) && exported.dailyPlans.length === 11, `${exported.dailyPlans?.length}`);
  const targets = exported.dailyPlans.map((p) => p.internalTarget);
  check('Adaptive Planung: Ziel steigt nie', targets.every((t, i) => i === 0 || t <= targets[i - 1]), targets.join(' → '));
  const [csv] = await Promise.all([page.waitForEvent('download'), button('Einträge exportieren (CSV)').click()]);
  check('CSV-Export', readFileSync(await csv.path(), 'utf8').split('\n').length === 154);
  await button('Fertig').click();
  await settle();

  // --- Screens mit Daten, hell und dunkel ---------------------------------------
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await settle(300);
    await tab('Heute');
    await shot(`20-heute-${scheme}`);
    await tab('Verlauf');
    await shot(`21-verlauf-${scheme}`);
    await button('Liste').or(page.getByRole('tab', { name: 'Liste' })).first().click();
    await settle();
    await shot(`22-verlauf-liste-${scheme}`);
    await tab('Insights');
    await shot(`23-insights-${scheme}`);
    await page.locator('main').evaluate((el) => el.scrollTo(0, 620));
    await settle(200);
    await shot(`24-insights-charts-${scheme}`);
    await page.locator('main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await settle(200);
    await shot(`25-insights-ende-${scheme}`);
    await tab('Coach');
    await button('Wie stark habe ich reduziert?').click();
    await settle(700);
    await shot(`26-coach-${scheme}`);
  }
  check('Coach antwortet lokal ohne KI', await page.getByText(/weniger\./).first().isVisible());
  await tab('Insights');
  check('Insights enthalten Textaussagen', (await page.getByText(/weniger als zu deinem Ausgangsniveau/).count()) > 0);
  check('Charts sind gerendert', (await page.locator('svg[role=img]').count()) >= 4);

  // --- Offline ------------------------------------------------------------------
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await settle(1200);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Heute' }).waitFor();
  await settle();
  const before = await count();
  await button('Zigarette').click();
  await button('Überspringen').click();
  await settle();
  check('Offline: App startet und speichert', (await count()) === before + 1);
  await tab('Insights');
  check('Offline: Insights verfügbar', (await page.locator('svg[role=img]').count()) >= 4);
  await context.setOffline(false);

  // --- Kein horizontales Scrollen -------------------------------------------------
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('Kein horizontaler Überlauf', !overflow);
  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('Testlauf', false, String(e).split('\n')[0]);
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden. Screenshots: scripts/.smoke/`);
process.exit(failed ? 1 : 0);

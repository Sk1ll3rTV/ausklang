import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * Schlanke SVG-Charts im iOS-Stil. Konventionen:
 * – eine Achse, zurückhaltendes Raster, Beschriftung in Textfarben (nie in der Datenfarbe)
 * – Balken mit 4px-Rundung am Datenende, 2px Abstand; Linien 2px, Marker mit Flächenring
 * – Antippen/Ziehen wählt einen Wert, die Kopfzeile zeigt ihn an
 */

const PLOT_COLOR = 'var(--chart)';
const NEUTRAL_COLOR = 'var(--chart-neutral)';
const AXIS_W = 30;
const X_AXIS_H = 18;
const TOP = 6;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 4) return Math.max(2, Math.ceil(v / 2) * 2);
  const steps = [5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 500, 1000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 500) * 500;
}

/** Wählt per Antippen/Ziehen einen Index entlang der x-Achse. */
function useSelection(count: number, plotWidth: number) {
  const [selected, setSelected] = useState<number | null>(null);
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (count === 0 || plotWidth <= 0) return;
    setSelected(Math.min(count - 1, Math.max(0, Math.floor((x / plotWidth) * count))));
  };
  return {
    selected: selected !== null && selected < count ? selected : null,
    handlers: {
      onPointerDown: pick,
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
        if (e.pointerType === 'mouse' || e.buttons > 0) pick(e);
      },
      onPointerLeave: (e: PointerEvent<SVGSVGElement>) => {
        if (e.pointerType === 'mouse') setSelected(null);
      },
    },
    clear: () => setSelected(null),
  };
}

function Readout({ title, value, hint }: { title: string; value: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink2">{title}</p>
        <p className="num text-[22px] font-semibold leading-tight text-ink">{value}</p>
      </div>
      {hint && <p className="shrink-0 pb-0.5 text-[12px] text-ink3">{hint}</p>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-[12px] text-ink2">
          <span
            aria-hidden="true"
            className="inline-block rounded-full"
            style={{ width: it.line ? 14 : 8, height: it.line ? 2 : 8, background: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function Grid({ ticks, y, width, format }: { ticks: number[]; y: (v: number) => number; width: number; format: (v: number) => string }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={width - AXIS_W + 4} y1={y(t)} y2={y(t)} stroke="var(--sep)" strokeWidth={1} />
          <text x={width} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ink3)">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ labels, x, y }: { labels: (string | undefined)[]; x: (i: number) => number; y: number }) {
  return (
    <g>
      {labels.map((l, i) =>
        l ? (
          <text key={i} x={x(i)} y={y} textAnchor="middle" fontSize={10.5} fill="var(--ink3)">
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Beschriftet höchstens ~5 Positionen, damit nichts kollidiert. */
export function sparseLabels(labels: string[], max = 5): (string | undefined)[] {
  if (labels.length <= max) return labels;
  const step = Math.ceil((labels.length - 1) / (max - 1));
  return labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? l : undefined)).map((l, i, arr) => {
    // Vorletztes Label weglassen, wenn es am letzten klebt.
    if (l && i !== arr.length - 1 && arr.length - 1 - i < step / 2) return undefined;
    return l;
  });
}

function barPath(x: number, yTop: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${yTop + h}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yTop + h}Z`;
}

export interface BarDatum {
  key: string;
  /** Ausführliche Bezeichnung für die Kopfzeile. */
  label: string;
  axisLabel?: string;
  value: number;
  /** Zweiter, neutraler Anteil – wird über dem ersten gestapelt. */
  secondary?: number;
}

export function BarChart({
  data,
  line,
  title,
  summary,
  format,
  height = 150,
  ariaLabel,
}: {
  data: BarDatum[];
  /** Überlagerte Linie auf derselben Achse (z. B. gleitender Schnitt). */
  line?: (number | null)[];
  title: string;
  summary: ReactNode;
  format: (d: BarDatum) => ReactNode;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = height - X_AXIS_H - TOP;
  const sel = useSelection(data.length, plotW);
  const max = niceMax(Math.max(1, ...data.map((d) => d.value + (d.secondary ?? 0)), ...(line ?? []).map((v) => v ?? 0)));
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(26, slot - 2));
  const cx = (i: number) => slot * i + slot / 2;
  const selected = sel.selected !== null ? data[sel.selected] : null;

  const linePath = (line ?? [])
    .map((v, i) => (v === null ? null : `${cx(i)},${y(v)}`))
    .reduce<string>((acc, p, i, arr) => (p === null ? acc : acc + (i === 0 || arr[i - 1] === null ? 'M' : 'L') + p), '');

  return (
    <div>
      <Readout title={selected ? selected.label : title} value={selected ? format(selected) : summary} />
      <div ref={ref}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            className="block touch-pan-y"
            {...sel.handlers}
          >
            <Grid ticks={[0, max / 2, max]} y={y} width={width} format={(v) => String(Math.round(v))} />
            {data.map((d, i) => {
              const x = cx(i) - barW / 2;
              const dim = sel.selected !== null && sel.selected !== i ? 0.4 : 1;
              const hasTop = (d.secondary ?? 0) > 0;
              const h1 = (d.value / max) * plotH;
              const h2 = ((d.secondary ?? 0) / max) * plotH;
              const gap = hasTop && d.value > 0 ? 2 : 0;
              return (
                <g key={d.key} opacity={dim}>
                  {d.value > 0 && (
                    <path d={barPath(x, y(0) - h1, barW, h1, hasTop ? 0 : 4)} fill={PLOT_COLOR} />
                  )}
                  {hasTop && (
                    <path d={barPath(x, y(0) - h1 - h2, barW, Math.max(1, h2 - gap), 4)} fill={NEUTRAL_COLOR} />
                  )}
                </g>
              );
            })}
            {linePath && (
              <path d={linePath} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
            )}
            <XLabels labels={data.map((d) => d.axisLabel)} x={cx} y={height - 4} />
          </svg>
        )}
      </div>
    </div>
  );
}

export interface LinePoint {
  key: string;
  label: string;
  axisLabel?: string;
  value: number | null;
}

export function LineChart({
  points,
  title,
  summary,
  format,
  formatTick,
  area,
  zeroBased,
  height = 150,
  ariaLabel,
}: {
  points: LinePoint[];
  title: string;
  summary: ReactNode;
  format: (p: LinePoint) => ReactNode;
  formatTick: (v: number) => string;
  area?: boolean;
  zeroBased?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = height - X_AXIS_H - TOP;
  const sel = useSelection(points.length, plotW);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const rawMin = zeroBased ? 0 : Math.min(...values, Infinity);
  const rawMax = Math.max(...values, -Infinity);
  const pad = zeroBased ? 0 : Math.max(15, (rawMax - rawMin) * 0.2);
  const min = values.length ? rawMin - pad : 0;
  const max = values.length ? (zeroBased ? Math.max(1, rawMax * 1.1) : rawMax + pad) : 1;
  const y = (v: number) => TOP + plotH - ((v - min) / (max - min || 1)) * plotH;
  const slot = points.length ? plotW / points.length : 0;
  const cx = (i: number) => slot * i + slot / 2;
  const selected = sel.selected !== null ? points[sel.selected] : null;

  let path = '';
  let areaPath = '';
  let segStart: number | null = null;
  points.forEach((p, i) => {
    if (p.value === null) {
      if (segStart !== null) areaPath += `L${cx(i - 1)},${y(min)}L${cx(segStart)},${y(min)}Z`;
      segStart = null;
      return;
    }
    const cmd = segStart === null ? 'M' : 'L';
    path += `${cmd}${cx(i)},${y(p.value)}`;
    areaPath += `${cmd}${cx(i)},${y(p.value)}`;
    if (segStart === null) segStart = i;
    if (i === points.length - 1) areaPath += `L${cx(i)},${y(min)}L${cx(segStart)},${y(min)}Z`;
  });

  const showMarkers = points.length <= 16;
  return (
    <div>
      <Readout title={selected ? selected.label : title} value={selected ? format(selected) : summary} />
      <div ref={ref}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            className="block touch-pan-y"
            {...sel.handlers}
          >
            <Grid ticks={[min, (min + max) / 2, max]} y={y} width={width} format={formatTick} />
            {area && areaPath && <path d={areaPath} fill={PLOT_COLOR} opacity={0.14} />}
            {path && (
              <path d={path} fill="none" stroke={PLOT_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {points.map((p, i) =>
              p.value !== null && (showMarkers || sel.selected === i) ? (
                <circle
                  key={p.key}
                  cx={cx(i)}
                  cy={y(p.value)}
                  r={sel.selected === i ? 5.5 : 4}
                  fill={PLOT_COLOR}
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              ) : null,
            )}
            {sel.selected !== null && (
              <line
                x1={cx(sel.selected)}
                x2={cx(sel.selected)}
                y1={TOP}
                y2={TOP + plotH}
                stroke="var(--ink3)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}
            <XLabels labels={points.map((p) => p.axisLabel)} x={cx} y={height - 4} />
          </svg>
        )}
      </div>
    </div>
  );
}

/** Verteilung als beschriftete Balkenzeilen (Rangliste). */
export function RankList({ items, unit }: { items: { name: string; count: number }[]; unit: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.name}>
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="truncate">{it.name}</span>
            <span className="num shrink-0 text-ink2">{unit(it.count)}</span>
          </div>
          <div className="mt-1.5 h-[6px] rounded-full bg-fill">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(3, (it.count / max) * 100)}%`, background: PLOT_COLOR }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export { NEUTRAL_COLOR, PLOT_COLOR };

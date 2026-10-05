import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Titel sichtbar anzeigen (sonst nur für Screenreader). */
  showTitle?: boolean;
  /** Fast volle Höhe, z. B. für Einstellungen oder Tagesdetails. */
  tall?: boolean;
  /** Schaltfläche links im Kopf, z. B. „Überspringen“. */
  leading?: ReactNode;
  /** Schaltfläche rechts im Kopf, z. B. „Fertig“. */
  trailing?: ReactNode;
  children: ReactNode;
}

const CLOSE_MS = 380;

/** Bottom Sheet im iOS-Stil: Federkurve, Griff, nach unten ziehen zum Schließen. */
export function Sheet({ open, onClose, title, showTitle = true, tall, leading, trailing, children }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; startT: number } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { startY: e.clientY, startT: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.startY));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.clientY - drag.current.startY);
    const velocity = dy / Math.max(1, e.timeStamp - drag.current.startT);
    drag.current = null;
    setDragY(0);
    if (dy > 110 || velocity > 0.6) onClose();
  };

  const dragging = dragY > 0;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ background: 'var(--scrim)', opacity: shown ? 1 : 0 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[30px] border-t-[0.5px] border-[var(--glass-border)] shadow-[0_-12px_40px_rgba(0,0,0,0.16)]"
        style={{
          background: 'var(--sheet)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          maxHeight: 'calc(100% - max(env(safe-area-inset-top), 20px) - 8px)',
          height: tall ? 'calc(100% - max(env(safe-area-inset-top), 20px) - 8px)' : undefined,
          transform: shown ? `translateY(${dragY}px)` : 'translateY(105%)',
          transition: dragging ? 'none' : `transform ${CLOSE_MS}ms var(--ease-sheet)`,
        }}
      >
        <div
          className="shrink-0 cursor-grab touch-none px-4 pt-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto h-[5px] w-9 rounded-full bg-fill2" />
          <div className="grid min-h-[48px] grid-cols-[1fr_auto_1fr] items-center gap-2 pt-1">
            <div className="justify-self-start" onPointerDown={(e) => e.stopPropagation()}>
              {leading}
            </div>
            <h2 className={showTitle ? 'text-center text-[17px] font-semibold' : 'sr-only'}>{title}</h2>
            <div className="justify-self-end" onPointerDown={(e) => e.stopPropagation()}>
              {trailing}
            </div>
          </div>
        </div>
        <div
          className="scroll-area min-h-0 flex-1 px-5"
          style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 12px)' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Textschaltfläche für den Sheet-Kopf. */
export function SheetAction({
  children,
  onClick,
  strong,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  strong?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pressable -mx-2 min-h-[44px] rounded-full px-3 text-[17px] text-accent disabled:opacity-40 ${strong ? 'font-semibold' : ''}`}
    >
      {children}
    </button>
  );
}

/** Behält den letzten Wert, solange ein Sheet noch ausblendet. */
export function useLatched<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null);
  if (value !== null && value !== undefined) ref.current = value;
  return ref.current;
}

import type { ReactNode } from 'react';

const PATHS = {
  today: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l2.9 1.9" />
    </>
  ),
  history: (
    <>
      <rect x="3.8" y="5.2" width="16.4" height="15" rx="3.6" />
      <path d="M3.8 10h16.4M8.2 3.4v3.4M15.8 3.4v3.4" />
    </>
  ),
  insights: <path d="M5 19.5v-6M10 19.5v-11M15 19.5v-8M20 19.5V5" />,
  coach: (
    <>
      <path d="M12 4.2c4.7 0 8.3 3.1 8.3 7.2s-3.6 7.2-8.3 7.2c-.9 0-1.8-.1-2.6-.4L5 19.8l1-3.4c-1.4-1.3-2.3-3-2.3-5 0-4.1 3.6-7.2 8.3-7.2Z" />
      <path d="M8.8 11.5h.01M12 11.5h.01M15.2 11.5h.01" />
    </>
  ),
  gear: (
    <>
      <path d="M4 8h9.500M17.500 8H20M4 16h2.500M10.500 16H20" />
      <circle cx="15.500" cy="8" r="2" />
      <circle cx="8.500" cy="16" r="2" />
    </>
  ),
  check: <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m8.4 12.3 2.5 2.5 4.8-5.1" />
    </>
  ),
  minusCircle: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M8.4 12h7.2" />
    </>
  ),
  upCircle: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 16V8.4M8.8 11.4 12 8.2l3.2 3.2" />
    </>
  ),
  chevronRight: <path d="m9.5 5.5 6 6.5-6 6.5" />,
  chevronLeft: <path d="m14.5 5.5-6 6.5 6 6.5" />,
  chevronDown: <path d="m5.5 9.5 6.5 6 6.5-6" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  trash: (
    <>
      <path d="M4.8 7.2h14.4M9.6 7.2V5.4c0-.7.5-1.2 1.2-1.2h2.4c.7 0 1.2.5 1.2 1.2v1.8M6.6 7.2l.8 11c.1.9.8 1.6 1.7 1.6h5.8c.9 0 1.6-.7 1.7-1.6l.8-11" />
    </>
  ),
  wave: <path d="M3.5 12c2.1-3.6 4.3-3.6 6.4 0s4.3 3.6 6.4 0 3.200-3.300 4.200-1.800" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 2" />
    </>
  ),
  wind: <path d="M3.5 9.5h9.7a2.600 2.600 0 1 0-2.500-3.300M3.5 13.500h14a2.800 2.800 0 1 1-2.700 3.600M3.500 17.500h6" />,
  drop: <path d="M12 3.800c3.200 3.700 5.600 6.600 5.600 9.800a5.600 5.600 0 0 1-11.200 0c0-3.200 2.400-6.100 5.600-9.800Z" />,
  walk: (
    <>
      <circle cx="13" cy="4.800" r="1.700" />
      <path d="m9.500 20.500 2-5.500-2-2.500 1-4.500 3.500 1 2 3 2.500 1M11.500 15l3 2 1 3.500M10.500 8 7.500 10l-.5 2.500" />
    </>
  ),
  spark: <path d="M12 3.500c.5 4.600 3.400 7.500 8 8-4.600.5-7.500 3.400-8 8-.5-4.600-3.400-7.500-8-8 4.600-.500 7.500-3.400 8-8Z" />,
  shuffle: <path d="M4 7.500h3.200c1.600 0 3 .8 3.800 2.200l2 3.600c.8 1.400 2.200 2.200 3.800 2.200H20M17.500 13l2.500 2.500-2.500 2.500M4 15.500h3.200c1.200 0 2.300-.5 3.100-1.300M20 7.500h-3.200c-1.200 0-2.300.5-3.100 1.300M17.500 5 20 7.500 17.500 10" />,
  list: <path d="M8.500 7h11M8.500 12h11M8.500 17h11M4.500 7h.01M4.500 12h.01M4.500 17h.01" />,
  send: <path d="M12 19V5.500M6.500 10.500 12 5l5.500 5.500" />,
  cigarette: (
    <>
      <rect x="3" y="13.200" width="14.500" height="3.600" rx="1.200" />
      <path d="M13.500 13.200v3.600M20.800 13.200v3.600M17.500 9.800c0-1.700-2.500-1.500-2.500-3.300 0-.800.4-1.400 1-1.800" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

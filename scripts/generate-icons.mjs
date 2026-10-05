// Erzeugt App-Icons und iOS-Startbilder als PNG – ohne Bild-Abhängigkeiten.
// Aufruf: npm run icons   (Ergebnis liegt in public/ und ist eingecheckt)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Motiv: ein Ring, der im Uhrzeigersinn ausklingt – Stärke und Deckkraft nehmen ab.
 * Liefert die Deckung (0–1) des Rings am Punkt (dx, dy) relativ zur Mitte.
 */
function ringCoverage(dx, dy, radius, thickness) {
  const r = Math.hypot(dx, dy);
  // Winkel 0 = oben, wächst im Uhrzeigersinn, 0–1
  const a = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  const fade = 1 - a;
  const half = (thickness * (0.38 + 0.62 * fade)) / 2;
  const aa = Math.max(0.75, thickness * 0.04);
  const band = 1 - smooth(half - aa, half + aa, Math.abs(r - radius));
  const opacity = 0.1 + 0.9 * Math.pow(fade, 1.35);
  return band * opacity;
}

function render(width, height, { background, ring, ringRadius }) {
  const buf = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const thickness = ringRadius * 0.3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bg = background(x / width, y / height);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      let color = bg;
      if (Math.abs(dx) < ringRadius * 1.3 && Math.abs(dy) < ringRadius * 1.3) {
        color = mix(bg, ring, ringCoverage(dx, dy, ringRadius, thickness));
      }
      const i = (y * width + x) * 4;
      buf[i] = Math.round(color[0]);
      buf[i + 1] = Math.round(color[1]);
      buf[i + 2] = Math.round(color[2]);
      buf[i + 3] = 255;
    }
  }
  return png(width, height, buf);
}

const iconBackground = (u, v) => {
  const base = mix([42, 94, 126], [20, 38, 60], Math.min(1, v * 0.85 + u * 0.25));
  const glow = Math.max(0, 1 - Math.hypot(u - 0.25, v - 0.15) / 0.8);
  return mix(base, [96, 160, 190], glow * 0.45);
};
const flat = (rgb) => () => rgb;

mkdirSync(join(root, 'icons'), { recursive: true });
mkdirSync(join(root, 'splash'), { recursive: true });

const icons = [
  ['icons/icon-192.png', 192, 0.3],
  ['icons/icon-512.png', 512, 0.3],
  ['icons/apple-touch-icon.png', 180, 0.3],
  // Maskable: Motiv bleibt in der sicheren Zone (innere 80 %).
  ['icons/icon-maskable-512.png', 512, 0.24],
];
for (const [file, size, radius] of icons) {
  writeFileSync(
    join(root, file),
    render(size, size, { background: iconBackground, ring: [244, 248, 250], ringRadius: size * radius }),
  );
}

// iOS zeigt Startbilder nur bei exakt passender Gerätegröße (siehe <link rel="apple-touch-startup-image">).
export const SPLASH_DEVICES = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [420, 912, 3],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 2],
];
const themes = {
  light: { background: flat([242, 242, 247]), ring: [46, 111, 149] },
  dark: { background: flat([0, 0, 0]), ring: [125, 183, 216] },
};
const links = [];
for (const [w, h, dpr] of SPLASH_DEVICES) {
  for (const [name, theme] of Object.entries(themes)) {
    const file = `splash/splash-${w}x${h}-${name}.png`;
    writeFileSync(join(root, file), render(w * dpr, h * dpr, { ...theme, ringRadius: w * dpr * 0.085 }));
    links.push(
      `    <link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${name})" />`,
    );
  }
}

writeFileSync(
  join(root, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f4a66"/><circle cx="32" cy="32" r="17" fill="none" stroke="#f4f8fa" stroke-width="5" stroke-linecap="round" stroke-dasharray="70 107" transform="rotate(-90 32 32)"/></svg>\n`,
);

console.log(`Icons und ${links.length} Startbilder erzeugt.\n\nLink-Tags für index.html:\n${links.join('\n')}`);

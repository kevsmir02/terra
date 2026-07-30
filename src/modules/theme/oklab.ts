const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: string | undefined): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toByte(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toOklab(hex: string): [number, number, number] {
  const [R, G, B] = channels(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab(L: number, A: number, B: number): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const h = (n: number) => toByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Raises a colour to a contrast floor by moving OKLab lightness only. Keeping
 * a and b fixed is what preserves hue and chroma: blending toward the theme
 * foreground also converges but desaturates the palette into grey.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (!isHexColor(color) || !isHexColor(bg)) return color;
  if (contrast(color, bg) >= min) return color;
  const [L0, A, B] = toOklab(color);
  const darken = luminance(bg) > 0.18;
  let lo = darken ? 0 : L0;
  let hi = darken ? L0 : 1;
  let best = fromOklab(darken ? 0 : 1, A, B);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const cand = fromOklab(mid, A, B);
    if (contrast(cand, bg) >= min) {
      best = cand;
      if (darken) lo = mid;
      else hi = mid;
    } else if (darken) hi = mid;
    else lo = mid;
  }
  return best;
}

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

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [toByte(r), toByte(g), toByte(b)];
}

const NUM = String.raw`(-?[\d.]+)%?`;
const FN = (name: string) =>
  new RegExp(String.raw`^${name}\(\s*${NUM}[\s,]+${NUM}[\s,]+${NUM}`);

const RGB_FN = FN("rgba?");
const HSL_FN = FN("hsla?");
const OKLCH_FN = FN("oklch");
const OKLAB_FN = FN("oklab");

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lig - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * 8-bit RGB for every notation the engine supports. Alpha is dropped: a
 * translucent colour has no fixed contrast, so callers that care use
 * `kind: "color"` and skip the maths entirely.
 *
 * oklch and oklab convert straight through the engine's own colour space.
 * Hex is the expensive one, needing sRGB to linear to oklab.
 */
export function parseColor(
  v: string | undefined,
): [number, number, number] | null {
  if (!v) return null;
  const s = v.trim();

  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h.slice(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const read = (re: RegExp): [number, number, number] | null => {
    const m = re.exec(s);
    if (!m) return null;
    const n = [Number(m[1]), Number(m[2]), Number(m[3])];
    return n.some((x) => !Number.isFinite(x)) ? null : [n[0], n[1], n[2]];
  };

  const rgb = read(RGB_FN);
  if (rgb) {
    return rgb.some((n) => n < 0 || n > 255) ? null : rgb;
  }

  const hsl = read(HSL_FN);
  if (hsl) return hslToRgb(hsl[0], hsl[1], hsl[2]);

  const checkPct = (name: string) => {
    const m = new RegExp(String.raw`^${name}\(\s*-?[\d.]+(%)?`).exec(s);
    return m ? m[1] === "%" : false;
  };

  // oklch is oklab in polar form: a = C*cos(H), b = C*sin(H).
  const lch = read(OKLCH_FN);
  if (lch) {
    let [L, C, H] = lch;
    if (checkPct("oklch")) L /= 100;
    const rad = (H * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
  }

  const lab = read(OKLAB_FN);
  if (lab) {
    let [L, A, B] = lab;
    if (checkPct("oklab")) L /= 100;
    return oklabToRgb(L, A, B);
  }

  return null;
}

function luminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toOklab(color: string): [number, number, number] {
  const rgb = parseColor(color);
  if (!rgb) return [0, 0, 0];
  const [R, G, B] = rgb.map(toLinear) as [number, number, number];
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
  const [r, g, b] = oklabToRgb(L, A, B);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Raises a colour to a contrast floor by moving OKLab lightness only. Keeping
 * a and b fixed is what preserves hue and chroma: blending toward the theme
 * foreground also converges but desaturates the palette into grey.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (!parseColor(color) || !parseColor(bg)) return color;
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

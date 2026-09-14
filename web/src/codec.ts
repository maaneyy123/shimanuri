// Packs one level (0-5) per island into a short URL-safe string.
//
// First char = island-list version (upper case, e.g. "A") and scheme:
//   upper case "A": dense   - the levels as one base-6 number (island i is the 6^i digit), base64url.
//                             Always about 187 chars for 432 islands. Kept so older links keep working.
//   lower case "a": modeled - arithmetic coding with adaptive counts, the context being the previous island's
//                             level. Short when many islands share a level or neighbours share levels.
// encodeLevels returns whichever is shorter. Islands added in a later list version are appended and decode as 0.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SIX = 6n;
const LEVELS = 6;

function toB64(n: bigint, minChars = 0): string {
  let s = "";
  while (n > 0n) {
    s = B64[Number(n & 63n)] + s;
    n >>= 6n;
  }
  return s.padStart(minChars, "A");
}
function fromB64(s: string): bigint | null {
  let n = 0n;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    n = (n << 6n) | BigInt(v);
  }
  return n;
}

// ---- dense ----
function encodeDense(levels: ArrayLike<number>): string {
  let n = 0n;
  for (let i = levels.length - 1; i >= 0; i--) n = n * SIX + BigInt(levels[i]);
  return toB64(n);
}
function decodeDense(body: string, count: number, total: number): Uint8Array | null {
  let n = fromB64(body);
  if (n == null) return null;
  const levels = new Uint8Array(total);
  for (let i = 0; i < count; i++) {
    levels[i] = Number(n % SIX);
    n /= SIX;
  }
  return n === 0n ? levels : null;
}

// ---- modeled (exact arithmetic coding with BigInt) ----
// counts[context][symbol], context = previous level (0 before the first island)
const INIT = 1;
const STEP = 2;
function newModel() {
  return Array.from({ length: LEVELS }, () => new Array<number>(LEVELS).fill(INIT));
}

function encodeModeled(levels: ArrayLike<number>): string {
  const model = newModel();
  // interval [low, low + width) / den
  let low = 0n;
  let width = 1n;
  let den = 1n;
  let ctx = 0;
  for (let i = 0; i < levels.length; i++) {
    const counts = model[ctx];
    const s = levels[i];
    const tot = counts.reduce((a, b) => a + b, 0);
    let cum = 0;
    for (let k = 0; k < s; k++) cum += counts[k];
    low = low * BigInt(tot) + width * BigInt(cum);
    width *= BigInt(counts[s]);
    den *= BigInt(tot);
    counts[s] += STEP;
    ctx = s;
  }
  // shortest m, b (b a multiple of 6) with low <= m/2^b * den < low + width
  for (let b = 0; ; b += 6) {
    const scale = 1n << BigInt(b);
    const m = (low * scale + den - 1n) / den;
    if (m * den < (low + width) * scale) return toB64(m, b / 6);
  }
}

function decodeModeled(body: string, count: number, total: number): Uint8Array | null {
  const m = fromB64(body);
  if (m == null) return null;
  const b = BigInt(body.length * 6);
  const model = newModel();
  const levels = new Uint8Array(total);
  // position of m/2^b inside the current interval, kept as integers: (m*den - low*2^b) / (width*2^b)
  let low = 0n;
  let width = 1n;
  let den = 1n;
  let ctx = 0;
  for (let i = 0; i < count; i++) {
    const counts = model[ctx];
    const tot = counts.reduce((a, x) => a + x, 0);
    const offset = m * den - (low << b);
    const span = width << b;
    if (offset < 0n || offset >= span) return null;
    const t = Number((offset * BigInt(tot)) / span);
    let s = 0;
    let cum = 0;
    while (s < LEVELS - 1 && cum + counts[s] <= t) cum += counts[s++];
    low = low * BigInt(tot) + width * BigInt(cum);
    width *= BigInt(counts[s]);
    den *= BigInt(tot);
    counts[s] += STEP;
    levels[i] = s;
    ctx = s;
  }
  return levels;
}

export const encodeDenseCode = (levels: ArrayLike<number>, version: string) => version.toUpperCase() + encodeDense(levels);
export const encodeModeledCode = (levels: ArrayLike<number>, version: string) => version.toLowerCase() + encodeModeled(levels);

export function encodeLevels(levels: ArrayLike<number>, version: string): string {
  const dense = encodeDenseCode(levels, version);
  const modeled = encodeModeledCode(levels, version);
  return modeled.length < dense.length ? modeled : dense;
}

export function decodeLevels(code: string, versions: Record<string, number>, total: number): Uint8Array | null {
  const head = code.charAt(0);
  const count = versions[head.toUpperCase()];
  if (count === undefined || count > total) return null;
  const body = code.slice(1);
  return head === head.toUpperCase() ? decodeDense(body, count, total) : decodeModeled(body, count, total);
}

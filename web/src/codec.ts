// Packs one small value per island into a short URL-safe string: the level (0-5) and, in a second code, the mark (0-3).
//
// First char = island-list version (upper case, e.g. "A") and scheme:
//   upper case "A": dense   - the values as one base-k number (island i is the k^i digit), base64url.
//                             Always about 187 chars for 432 levels. Kept so older links keep working.
//   lower case "a": modeled - arithmetic coding with adaptive counts, the context being the previous island's
//                             value. Short when many islands share a value or neighbours share values.
// encodeLevels / encodeMarks return whichever is shorter. Islands added in a later list version are appended and decode as 0.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LEVELS = 6;
const MARKS = 6;

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
function encodeDense(values: ArrayLike<number>, k: number): string {
  const base = BigInt(k);
  let n = 0n;
  for (let i = values.length - 1; i >= 0; i--) n = n * base + BigInt(values[i]);
  return toB64(n);
}
function decodeDense(body: string, count: number, total: number, k: number): Uint8Array | null {
  const base = BigInt(k);
  let n = fromB64(body);
  if (n == null) return null;
  const values = new Uint8Array(total);
  for (let i = 0; i < count; i++) {
    values[i] = Number(n % base);
    n /= base;
  }
  return n === 0n ? values : null;
}

// ---- modeled (exact arithmetic coding with BigInt) ----
// counts[context][symbol], context = previous value (0 before the first island)
const INIT = 1;
const STEP = 2;
function newModel(k: number) {
  return Array.from({ length: k }, () => new Array<number>(k).fill(INIT));
}

function encodeModeled(levels: ArrayLike<number>, k: number): string {
  const model = newModel(k);
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

function decodeModeled(body: string, count: number, total: number, k: number): Uint8Array | null {
  const m = fromB64(body);
  if (m == null) return null;
  const b = BigInt(body.length * 6);
  const model = newModel(k);
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
    while (s < k - 1 && cum + counts[s] <= t) cum += counts[s++];
    low = low * BigInt(tot) + width * BigInt(cum);
    width *= BigInt(counts[s]);
    den *= BigInt(tot);
    counts[s] += STEP;
    levels[i] = s;
    ctx = s;
  }
  return levels;
}

export const encodeDenseCode = (levels: ArrayLike<number>, version: string, k = LEVELS) => version.toUpperCase() + encodeDense(levels, k);
export const encodeModeledCode = (levels: ArrayLike<number>, version: string, k = LEVELS) => version.toLowerCase() + encodeModeled(levels, k);

function encode(values: ArrayLike<number>, version: string, k: number): string {
  const dense = encodeDenseCode(values, version, k);
  const modeled = encodeModeledCode(values, version, k);
  return modeled.length < dense.length ? modeled : dense;
}

function decode(code: string, versions: Record<string, number>, total: number, k: number): Uint8Array | null {
  const head = code.charAt(0);
  const count = versions[head.toUpperCase()];
  if (count === undefined || count > total) return null;
  const body = code.slice(1);
  return head === head.toUpperCase() ? decodeDense(body, count, total, k) : decodeModeled(body, count, total, k);
}

export const encodeLevels = (levels: ArrayLike<number>, version: string) => encode(levels, version, LEVELS);
export const decodeLevels = (code: string, versions: Record<string, number>, total: number) => decode(code, versions, total, LEVELS);
// marks: 0 = ○ (the default), 1 = △, 2 = □, 3 = ◇, 4 = ☆, 5 = ✕
export const encodeMarks = (marks: ArrayLike<number>, version: string) => encode(marks, version, MARKS);
export const decodeMarks = (code: string, versions: Record<string, number>, total: number) => decode(code, versions, total, MARKS);

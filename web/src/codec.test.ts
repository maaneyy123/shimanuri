import { describe, expect, it } from "vitest";
import { decodeLevels, encodeDenseCode, encodeLevels, encodeModeledCode } from "./codec";

const V = { A: 432 };
// A link in the format of the first (dense-only) encoder, made from seeded random levels (142 islands painted).
// Links of that format are in use and must keep working.
const DENSE_LINK =
  "ABc6iyjBmwuNnp6P8JxnkoVavbpaCn5ph0IyAtWN1-JkOlCDCUDcf8y6DQOmEC2IaHggXFBeB2WcLQRrmXUpHv2ou2fNnbJuIBPIOjlxfMO4JmdS9sHrhgS1FQO-LuMhRuv0LhHUrERxamcmzZG_E1QbaHoiFxghbKaUv0aPQTd9eNQGjic8lPnba9UU";

const roundTrip = (levels: Uint8Array) => {
  const code = encodeLevels(levels, "A");
  expect(code.length).toBeLessThanOrEqual(188);
  expect(Array.from(decodeLevels(code, V, 432)!)).toEqual(Array.from(levels));
  return code;
};

describe("level codec", () => {
  it("round-trips 300 uniformly random states", () => {
    for (let t = 0; t < 300; t++) roundTrip(Uint8Array.from({ length: 432 }, () => Math.floor(Math.random() * 6)));
  });

  it("round-trips 300 mostly-unvisited states and keeps them short", () => {
    for (let t = 0; t < 300; t++) {
      const levels = Uint8Array.from({ length: 432 }, () => (Math.random() < 0.8 ? 0 : 1 + Math.floor(Math.random() * 5)));
      roundTrip(levels);
    }
  });

  it("encodes the all-unvisited state in a few chars", () => {
    const code = roundTrip(new Uint8Array(432));
    expect(code.length).toBeLessThanOrEqual(4);
  });

  it("still opens a dense-format link and re-encodes it shorter", () => {
    const levels = decodeLevels(DENSE_LINK, V, 432)!;
    expect(levels).not.toBeNull();
    expect(levels.filter((v) => v > 0).length).toBe(142);
    const code = roundTrip(levels);
    expect(code.length).toBeLessThan(DENSE_LINK.length);
  });

  it("reads an older list version and leaves appended islands unvisited (both schemes)", () => {
    const old = Uint8Array.from({ length: 432 }, (_, i) => (i * 7) % 6);
    for (const code of [encodeDenseCode(old, "A"), encodeModeledCode(old, "A")]) {
      const now = decodeLevels(code, { A: 432, B: 440 }, 440)!;
      expect(Array.from(now.slice(0, 432))).toEqual(Array.from(old));
      expect(Array.from(now.slice(432))).toEqual(new Array(8).fill(0));
    }
  });

  it("returns no record for unknown versions and unreadable strings", () => {
    expect(decodeLevels("Z123", V, 432)).toBeNull();
    expect(decodeLevels("A!!", V, 432)).toBeNull();
    expect(decodeLevels("A" + "_".repeat(200), V, 432)).toBeNull();
  });
});

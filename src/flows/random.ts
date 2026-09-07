import { integer } from "../validation/parse.js";
export interface RandomResult {
  state: number;
  value: number;
}
/** Explicit 32-bit LCG. Deterministic simulation randomness, not cryptographic randomness. */
export function nextRandom(state: number, exclusiveMax: number): RandomResult {
  integer(state, 0, 0xffffffff);
  integer(exclusiveMax, 1, 0x100000000);
  // Rejection sampling avoids modulo bias for non-power-of-two bounds.
  const limit = Math.floor(0x100000000 / exclusiveMax) * exclusiveMax;
  let next = state;
  do {
    next = (Math.imul(next, 1664525) + 1013904223) >>> 0;
  } while (next >= limit);
  return { state: next, value: next % exclusiveMax };
}

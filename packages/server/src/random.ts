import { randomInt } from "node:crypto";

// All game randomness goes through this, so tests can swap in a scripted source.
export interface RandomSource {
  // Integer in [min, max], inclusive.
  int(min: number, max: number): number;
}

export const cryptoRandom: RandomSource = {
  int: (min, max) => randomInt(min, max + 1),
};

export function pick<T>(rng: RandomSource, items: readonly T[]): T {
  if (!items.length) throw new Error("pick from empty list");
  return items[rng.int(0, items.length - 1)];
}

// Weighted pick. Weights are scaled to integers so the crypto RNG can be used.
export function pickWeighted<T extends { weight: number }>(rng: RandomSource, items: readonly T[]): T {
  const SCALE = 1000;
  const weights = items.map((i) => Math.max(1, Math.round(i.weight * SCALE)));
  let roll = rng.int(1, weights.reduce((a, b) => a + b, 0));
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

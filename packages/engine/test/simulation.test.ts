import { describe, expect, it } from "vitest";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import {
  apply,
  createBoardState,
  currentPlayerId,
  EngineError,
  replay,
  starCandidates,
  type Action,
  type BoardState,
  type EngineContext,
  type EngineEvent,
} from "../src";
import { HOUR, T0 } from "./helpers";

// Small seeded PRNG so a failing run can be reproduced from its seed.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const layout = loadLayouts().main;
const config = loadSeasonConfig();
// The real config, plus a stand-in shop and wheel so those paths get exercised.
const ctx: EngineContext = {
  layout,
  rules: {
    ...config,
    shop: {
      maxPerVisit: 2,
      items: [
        { id: "mushroom", name: "Mushroom", price: 5 },
        { id: "double-dice", name: "Double Dice", price: 10 },
        { id: "golden-pipe", name: "Golden Pipe", price: 25 },
      ],
    },
    bowser: {
      wheel: [
        { id: "coins-10", label: "Lose 10 coins", weight: 3, coins: -10, stars: 0 },
        { id: "star", label: "Lose a star", weight: 1, coins: 0, stars: -1 },
        { id: "nothing", label: "Bowser's in a good mood", weight: 1, coins: 0, stars: 0 },
      ],
    },
  },
};
const edges = new Set(layout.spaces.flatMap((s) => s.next.map((n) => `${s.id}>${n}`)));
const blue = new Set(layout.spaces.filter((s) => s.type === "blue").map((s) => s.id));

function checkInvariants(state: BoardState, events: EngineEvent[]) {
  const ids = Object.keys(state.players);
  expect([...state.turn.order].sort()).toEqual([...ids].sort());
  if (state.turn.order.length) expect(state.turn.index).toBeLessThan(state.turn.order.length);
  for (const p of Object.values(state.players)) {
    expect(Number.isInteger(p.coins) && p.coins >= 0).toBe(true);
    expect(Number.isInteger(p.stars) && p.stars >= 0).toBe(true);
    expect(layout.spaces.some((s) => s.id === p.space)).toBe(true);
  }
  if (state.star !== null) expect(blue.has(state.star)).toBe(true);
  if (state.move) expect(state.move.playerId).toBe(currentPlayerId(state));
  for (const e of events) {
    if (e.type === "PlayerMoved") expect(edges.has(`${e.from}>${e.to}`)).toBe(true);
  }
  // State must survive JSON storage unchanged.
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
}

function simulate(seed: number, players: number, turns: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const initial = createBoardState(ctx, {
    boardId: `sim-${seed}`,
    starSpace: config.boards[0].starStart ?? null,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `player ${i}` })),
  });
  let state = initial;
  let now = T0;
  const actions: Action[] = [];
  const stats = { rolls: 0, skips: 0, stars: 0, shops: 0, forks: 0, bowser: 0 };

  const step = (action: Action) => {
    const r = apply(ctx, state, action);
    checkInvariants(r.state, r.events);
    for (const e of r.events) {
      if (e.type === "TurnSkipped") stats.skips++;
      if (e.type === "StarPurchased") stats.stars++;
      if (e.type === "ShopPurchase") stats.shops++;
      if (e.type === "ForkChosen") stats.forks++;
      if (e.type === "BowserSpin") stats.bowser++;
    }
    state = r.state;
    actions.push(action);
  };

  step({ type: "startBoard", now });
  while (stats.rolls < turns) {
    const pid = currentPlayerId(state)!;
    const opens = state.turn.windowOpensAt!;
    // Most players roll somewhere in their window; some miss it entirely.
    if (rnd() < 0.08 && state.turn.deadline !== null) {
      now = state.turn.deadline + Math.floor(rnd() * HOUR);
      step({ type: "tick", now });
      continue;
    }
    now = Math.max(now, opens) + Math.floor(rnd() * 11 * HOUR);
    step({ type: "roll", playerId: pid, dice: [1 + Math.floor(rnd() * 10)], now });
    stats.rolls++;

    // Answer prompts until the move finishes. Sometimes let one time out instead.
    while (state.move) {
      const c = state.move.choice!;
      now += Math.floor(rnd() * 30) * 60_000;
      if (c.kind !== "bowser" && rnd() < 0.1) {
        now = c.expiresAt;
        step({ type: "tick", now });
      } else if (c.kind === "fork") step({ type: "chooseFork", playerId: pid, next: pick(c.options), now });
      else if (c.kind === "star")
        step(rnd() < 0.7 ? { type: "buyStar", playerId: pid, newStarSpace: pick(starCandidates(ctx, state)), now } : { type: "skipStar", playerId: pid, now });
      else if (c.kind === "shop") {
        const coins = state.players[pid].coins;
        const affordable = ctx.rules.shop.items.filter((i) => i.price <= coins);
        step(rnd() < 0.6 && affordable.length ? { type: "shopBuy", playerId: pid, itemId: pick(affordable).id, now } : { type: "shopSkip", playerId: pid, now });
      } else {
        step({ type: "spinBowser", playerId: pid, outcomeId: pick(ctx.rules.bowser.wheel).id, now });
      }
    }

    // Occasional host chaos.
    if (rnd() < 0.02) step({ type: "setCoins", playerId: pick(state.turn.order), coins: Math.floor(rnd() * 50), now });
    if (rnd() < 0.01) step({ type: "moveStar", spaceId: pick(starCandidates(ctx, state)), now });
    if (rnd() < 0.01) {
      step({ type: "pause", now });
      now += Math.floor(rnd() * 24) * HOUR;
      step({ type: "resume", now });
    }
  }
  return { initial, state, actions, stats };
}

describe("long random simulation", () => {
  // Four boards like the real season: three of 4 players and one of 5.
  const boards = [
    { seed: 1, players: 4 },
    { seed: 2, players: 4 },
    { seed: 3, players: 4 },
    { seed: 4, players: 5 },
  ];

  for (const { seed, players } of boards) {
    it(`board seed ${seed} (${players} players): 2,500 turns keep every invariant and replay exactly`, () => {
      const { initial, state, actions, stats } = simulate(seed, players, 2500);
      expect(stats.rolls).toBe(2500);
      // Every mechanic actually happened.
      for (const n of Object.values(stats)) expect(n).toBeGreaterThan(0);
      expect(replay(ctx, { initial, actions }).state).toEqual(state);
    });
  }

  it("player actions out of turn are always rejected with a plain EngineError", () => {
    const { state } = simulate(9, 4, 50);
    const notCurrent = state.turn.order.find((id) => id !== currentPlayerId(state))!;
    expect(() => apply(ctx, state, { type: "roll", playerId: notCurrent, dice: [3], now: Number.MAX_SAFE_INTEGER })).toThrow(EngineError);
  });
});

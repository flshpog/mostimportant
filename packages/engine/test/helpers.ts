import type { Board } from "@everest/board-data";
import { apply, createBoardState, type Action, type BoardState, type EngineContext, type EngineEvent, type Rules } from "../src";

export const HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 10, 1, 12); // arbitrary fixed start time

export const rules: Rules = {
  coins: { starting: 10, blue: 3, red: -3, green: 0, floor: 0 },
  star: { price: 20, spawnOn: ["blue"] },
  dice: { min: 1, max: 10 },
  turns: { cooldownHours: 4, windowHours: 12, firstTurnUnlimited: true, choiceTimeoutMinutes: 60 },
  shop: {
    maxPerVisit: 1,
    items: [
      { id: "mushroom", name: "Mushroom", price: 5, effect: { kind: "dice", count: 2, min: 1, max: 10 } },
      { id: "golden-pipe", name: "Golden Pipe", price: 30, effect: { kind: "dice", count: 3, min: 1, max: 10 } },
    ],
    bagSize: 3,
    stockSize: 2,
    variants: {},
  },
  events: {
    coinSteal: { weight: 1, percents: [5, 10, 25, 50] },
    starSteal: { weight: 1, price: 40 },
    swap: { weight: 1 },
  },
};

const pos = (i: number) => ({ x: (i % 10) / 10, y: Math.floor(i / 10) / 10 });

// s01 start -> s02 blue -> s03 red -> s04 green -> s05 shop -> s06 event -> s07 blue (fork)
//   s07 -> s08 blue -> s09 blue -> s01
//   s07 -> s10 red -> s01
export const lineLayout: Board = {
  id: "line",
  name: "test line",
  startSpace: "s01",
  bridges: [],
  spaces: [
    { id: "s01", type: "start", pos: pos(1), next: ["s02"] },
    { id: "s02", type: "blue", pos: pos(2), next: ["s03"] },
    { id: "s03", type: "red", pos: pos(3), next: ["s04"] },
    { id: "s04", type: "green", pos: pos(4), next: ["s05"] },
    { id: "s05", type: "shop", pos: pos(5), next: ["s06"], passEffect: true },
    { id: "s06", type: "event", pos: pos(6), next: ["s07"] },
    { id: "s07", type: "blue", pos: pos(7), next: ["s08", "s10"] },
    { id: "s08", type: "blue", pos: pos(8), next: ["s09"] },
    { id: "s09", type: "blue", pos: pos(9), next: ["s01"] },
    { id: "s10", type: "red", pos: pos(10), next: ["s01"] },
  ],
};

export function ctxFor(layout: Board = lineLayout, overrides: Partial<Rules> = {}): EngineContext {
  return { layout, rules: { ...rules, ...overrides } };
}

// A small harness that applies actions and keeps the log, like the server will.
export class Game {
  state: BoardState;
  readonly initial: BoardState;
  readonly actions: Action[] = [];
  lastEvents: EngineEvent[] = [];
  now = T0;

  constructor(
    readonly ctx: EngineContext,
    players = ["alice", "bob", "cara"],
    starSpace: string | null = null,
  ) {
    this.state = createBoardState(ctx, {
      boardId: "test",
      starSpace,
      players: players.map((id) => ({ id, name: id })),
    });
    this.initial = this.state;
  }

  // What shops offer when the test reaches one (the server draws this at random);
  // by default the first items in the config.
  stock: string[] | null = null;

  do(action: Action): EngineEvent[] {
    const r = apply(this.ctx, this.state, action);
    this.state = r.state;
    this.actions.push(action);
    const events = [...r.events];
    // stock any shop reached, like the server does
    while (this.state.move?.choice?.kind === "shopDraw") {
      const items = this.stock ?? this.ctx.rules.shop.items.slice(0, this.ctx.rules.shop.stockSize).map((i) => i.id);
      const stock: Action = { type: "stockShop", playerId: this.state.move.playerId, items, now: action.now };
      const s = apply(this.ctx, this.state, stock);
      this.state = s.state;
      this.actions.push(stock);
      events.push(...s.events);
    }
    this.lastEvents = events;
    return events;
  }

  start() {
    return this.do({ type: "startBoard", now: this.now });
  }
  roll(playerId: string, ...dice: number[]) {
    return this.do({ type: "roll", playerId, dice, now: this.now });
  }
  advance(hours: number) {
    this.now += hours * HOUR;
  }
  tick() {
    return this.do({ type: "tick", now: this.now });
  }
  p(id: string) {
    return this.state.players[id];
  }
  // Puts a player on a space and makes it their turn, open now.
  setup(playerId: string, space: string, coins?: number) {
    this.state.players[playerId].space = space;
    if (coins !== undefined) this.state.players[playerId].coins = coins;
    this.state.turn.index = this.state.turn.order.indexOf(playerId);
    this.state.turn.windowOpensAt = this.now;
  }
}

export const types = (events: EngineEvent[]) => events.map((e) => e.type);

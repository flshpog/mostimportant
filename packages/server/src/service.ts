import { EventEmitter } from "node:events";
import type { Board, SeasonConfig } from "@everest/board-data";
import {
  apply,
  createBoardState,
  enabledEvents,
  possibleEvents,
  publicState,
  rollSpec,
  EngineError,
  starCandidates,
  type Action,
  type BoardState,
  type EngineContext,
  type EngineEvent,
  type PlayerState,
} from "@everest/engine";
import { cryptoRandom, pick, pickWeighted, type RandomSource } from "./random";
import { BoardStore, type LogEntry, type StoredEvent, type WireEvent } from "./store";

export const REDEMPTION_ISLAND_ID = "redemption-island";

// For lookups of things that don't exist (unknown board). Rule violations stay EngineError.
export class ServiceError extends Error {
  constructor(
    readonly code: "unknown_board",
    message: string,
  ) {
    super(message);
  }
}
// setTimeout can't wait longer than this; longer waits just re-arm.
const MAX_TIMER_MS = 2 ** 31 - 1;

// Host-only actions, as sent by the dashboard. `now` is filled in by the server.
export type HostAction = Extract<
  Action,
  {
    type:
      | "startBoard"
      | "setCoins"
      | "setStars"
      | "grantItem"
      | "removeItem"
      | "movePlayer"
      | "moveStar"
      | "addPlayer"
      | "removePlayer"
      | "setTurnOrder"
      | "openTurnNow"
      | "skipTurn"
      | "pause"
      | "resume";
  }
>;
export type HostActionInput = HostAction extends infer A ? (A extends { now: number } ? Omit<A, "now"> : never) : never;

// Who did something and from where, passed along with every "events" emit so the
// Discord side can tell its own actions from website rolls, timeouts and host edits.
export type ActionSource = "web" | "discord" | "timer";
export interface ActionMeta {
  by: string | null;
  source: ActionSource;
  host: boolean;
}
const TIMER: ActionMeta = { by: null, source: "timer", host: false };

export interface ServiceOptions {
  dataDir: string;
  layouts: Record<string, Board>;
  // Called for every action, so edits to season-config.json apply without a restart.
  loadConfig: () => SeasonConfig;
  random?: RandomSource;
  clock?: () => number;
  log?: (message: string, error?: unknown) => void;
}

export interface BoardSummary {
  id: string;
  name: string;
  layoutId: string;
  channelId: string;
  started: boolean;
  paused: boolean;
  players: number;
  seq: number;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  stars: number;
  coins: number;
}

interface BoardRuntime {
  id: string;
  name: string;
  layoutId: string;
  channelId: string;
  store: BoardStore;
  state: BoardState;
  entries: LogEntry[];
  events: StoredEvent[];
  seq: number;
  entry: number;
  timer: NodeJS.Timeout | null;
}

// Owns every board: loads them from disk, applies actions through the engine one at
// a time, persists each result, rolls the dice, and runs the turn/prompt timers.
// Emits:
//   "events" (boardId, StoredEvent[], state, ActionMeta)  after every accepted change
//   "reset"  (boardId, state, seq)                        after an undo; viewers should reload
export class BoardService extends EventEmitter {
  private readonly boards = new Map<string, BoardRuntime>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly rng: RandomSource;
  private readonly clock: () => number;
  private readonly log: (message: string, error?: unknown) => void;
  private closed = false;

  constructor(private readonly opts: ServiceOptions) {
    super();
    this.rng = opts.random ?? cryptoRandom;
    this.clock = opts.clock ?? Date.now;
    this.log = opts.log ?? ((m, e) => (e ? console.error(m, e) : console.log(m)));
  }

  // Loads (or creates) every board named in the season config.
  init() {
    const config = this.opts.loadConfig();
    const defs = config.boards.map((b) => ({ ...b }));
    // the merge board, once the hosts give it a channel
    if (config.merge?.channelId) {
      defs.push({ id: config.merge.id, name: config.merge.name, layout: config.merge.layout, channelId: config.merge.channelId, starStart: config.merge.starStart });
    }
    if (config.redemptionIsland.layout) {
      defs.push({
        id: REDEMPTION_ISLAND_ID,
        name: "Redemption Island",
        layout: config.redemptionIsland.layout,
        channelId: config.redemptionIsland.channelId,
        starStart: undefined,
      });
    }
    for (const def of defs) {
      const layout = this.opts.layouts[def.layout];
      if (!layout) {
        this.log(`[board] skipping ${def.id}: no layout "${def.layout}"`);
        continue;
      }
      const store = new BoardStore(this.opts.dataDir, def.id);
      const rt: BoardRuntime = {
        id: def.id,
        name: def.name,
        layoutId: def.layout,
        channelId: def.channelId,
        store,
        state: null as unknown as BoardState,
        entries: [],
        events: [],
        seq: 0,
        entry: 0,
        timer: null,
      };
      this.load(rt, def.starStart ?? null);
      this.boards.set(def.id, rt);
      this.schedule(rt);
    }
  }

  close() {
    this.closed = true;
    for (const b of this.boards.values()) if (b.timer) clearTimeout(b.timer);
  }

  private ctx(rt: BoardRuntime): EngineContext {
    return { layout: this.opts.layouts[rt.layoutId], rules: this.opts.loadConfig() };
  }

  private load(rt: BoardRuntime, starStart: string | null) {
    const { entries, events, snapshot } = rt.store.load();
    rt.entries = entries;
    rt.events = events;
    rt.seq = events.length ? events[events.length - 1].seq : 0;
    if (!entries.length) {
      const state = createBoardState(this.ctx(rt), { boardId: rt.id, starSpace: rt.id === REDEMPTION_ISLAND_ID ? null : starStart, players: [] });
      this.commit(rt, { kind: "init", by: null, state }, state, [], TIMER);
      return;
    }
    const last = entries[entries.length - 1];
    rt.entry = last.n;
    if (snapshot && snapshot.entry === last.n) {
      rt.state = snapshot.state;
      return;
    }
    // The snapshot is one write behind the log (crash between the two). Rebuild the
    // final state from the last entry, which always carries what it needs.
    if (last.kind === "action") rt.state = apply(this.ctx(rt), last.before, last.action).state;
    else rt.state = last.state;
    rt.store.writeSnapshot({ state: rt.state, entry: rt.entry, seq: rt.seq });
    this.log(`[board] ${rt.id}: recovered state from log entry ${rt.entry}`);
  }

  private commit(
    rt: BoardRuntime,
    entry: { kind: "init"; by: string | null; state: BoardState } | { kind: "action"; by: string | null; action: Action; before: BoardState } | { kind: "undo"; by: string | null; count: number; state: BoardState },
    state: BoardState,
    events: WireEvent[],
    meta: ActionMeta,
  ): StoredEvent[] {
    const at = this.clock();
    const n = rt.entry + 1;
    const stored = events.map((event) => ({ seq: ++rt.seq, at, entry: n, event }));
    const full = { ...entry, n, at } as LogEntry;
    rt.store.appendEvents(stored);
    rt.store.appendEntry(full);
    rt.entries.push(full);
    rt.events.push(...stored);
    rt.entry = n;
    rt.state = state;
    rt.store.writeSnapshot({ state, entry: n, seq: rt.seq });
    if (stored.length) this.emit("events", rt.id, stored, state, meta);
    return stored;
  }

  // Every mutation goes through one queue, so actions never interleave, even across
  // boards (transfers touch two at once).
  private enqueue<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // Applies one action and any follow-ups the server owns (drawing events).
  private applyLocked(rt: BoardRuntime, action: Action, meta: ActionMeta): StoredEvent[] {
    const before = rt.state;
    const result = apply(this.ctx(rt), before, action);
    if (action.type === "tick" && !result.events.length) return [];
    const out = this.commit(rt, { kind: "action", by: meta.by, action, before }, result.state, result.events, meta);
    // An event landing waits for the draw. That's the server's job, not the player's.
    while (rt.state.move?.choice?.kind === "eventDraw") {
      const ctx = this.ctx(rt);
      // only events that can actually happen; if none can, any enabled one (it fizzles)
      const possible = possibleEvents(ctx, rt.state, rt.state.move.playerId);
      const { event } = pickWeighted(this.rng, possible.length ? possible : enabledEvents(ctx));
      const percent = pick(this.rng, ctx.rules.events.coinSteal.percents);
      const draw: Action = { type: "drawEvent", playerId: rt.state.move.playerId, event, percent, now: this.clock() };
      const r = apply(ctx, rt.state, draw);
      out.push(...this.commit(rt, { kind: "action", by: null, action: draw, before: rt.state }, r.state, r.events, meta));
    }
    this.schedule(rt);
    return out;
  }

  private schedule(rt: BoardRuntime) {
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    if (this.closed) return;
    const s = rt.state;
    if (!s.started || s.paused) return;
    const c = s.move?.choice;
    const wake = c && c.kind !== "eventDraw" ? c.expiresAt : !s.move ? s.turn.deadline : null;
    if (wake === null) return;
    const delay = Math.min(Math.max(0, wake - this.clock()) + 25, MAX_TIMER_MS);
    rt.timer = setTimeout(() => {
      rt.timer = null;
      this.tick(rt.id).catch((e) => this.log(`[board] ${rt.id}: timer tick failed`, e));
    }, delay);
    rt.timer.unref?.();
  }

  private runtime(boardId: string): BoardRuntime {
    const rt = this.boards.get(boardId);
    if (!rt) throw new ServiceError("unknown_board", `There's no board called ${boardId}.`);
    return rt;
  }

  private boardOfPlayer(userId: string): BoardRuntime {
    for (const rt of this.boards.values()) if (rt.state.players[userId]) return rt;
    throw new EngineError("unknown_player", "You aren't on a board right now.");
  }

  // ---- reads ----

  boardIdOf(userId: string): string | null {
    for (const rt of this.boards.values()) if (rt.state.players[userId]) return rt.id;
    return null;
  }

  boardIds(): string[] {
    return [...this.boards.keys()];
  }

  summary(boardId: string): BoardSummary {
    const rt = this.runtime(boardId);
    return {
      id: rt.id,
      name: rt.name,
      layoutId: rt.layoutId,
      channelId: rt.channelId,
      started: rt.state.started,
      paused: rt.state.paused,
      players: rt.state.turn.order.length,
      seq: rt.seq,
    };
  }

  // The board as players may see it (no hidden next-star spot).
  state(boardId: string): { state: BoardState; seq: number } {
    const rt = this.runtime(boardId);
    return { state: publicState(rt.state), seq: rt.seq };
  }

  layout(boardId: string): Board {
    return this.opts.layouts[this.runtime(boardId).layoutId];
  }

  eventsSince(boardId: string, since: number, limit = 500): StoredEvent[] {
    const rt = this.runtime(boardId);
    // seq is dense and starts at 1, so it doubles as an index.
    return rt.events.slice(Math.max(0, since), Math.max(0, since) + limit);
  }

  leaderboard(boardId: string): LeaderboardRow[] {
    const players = Object.values(this.runtime(boardId).state.players);
    players.sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
    let rank = 0;
    return players.map((p, i) => {
      const prev = players[i - 1];
      if (!prev || prev.stars !== p.stars || prev.coins !== p.coins) rank = i + 1;
      return { rank, playerId: p.id, name: p.name, stars: p.stars, coins: p.coins };
    });
  }

  // ---- player actions (Discord buttons or the website) ----

  roll(userId: string, source: ActionSource = "web"): Promise<StoredEvent[]> {
    return this.enqueue(() => {
      const rt = this.boardOfPlayer(userId);
      // one die, or whatever a dice item calls for (a Reroll Block's two must differ)
      const spec = rollSpec(this.ctx(rt), rt.state, userId);
      const dice: number[] = [];
      while (dice.length < spec.count) {
        const d = this.rng.int(spec.min, spec.max);
        if (spec.distinct && dice.includes(d) && spec.max > spec.min) continue;
        dice.push(d);
      }
      const action: Action = { type: "roll", playerId: userId, dice, now: this.clock() };
      return this.applyLocked(rt, action, { by: userId, source, host: false });
    });
  }

  chooseFork(userId: string, next: string, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "chooseFork", playerId: userId, next, now }));
  }

  buyStar(userId: string, source: ActionSource = "web") {
    return this.enqueue(() => {
      const rt = this.boardOfPlayer(userId);
      const candidates = starCandidates(this.ctx(rt), rt.state);
      if (!candidates.length) throw new EngineError("invalid_star_space", "There's nowhere for the star to move to.");
      // where a Star Compass said it would go, if that's still a valid spot
      const next = rt.state.nextStar;
      const newStarSpace = next && candidates.includes(next) ? next : pick(this.rng, candidates);
      return this.applyLocked(rt, { type: "buyStar", playerId: userId, newStarSpace, now: this.clock() }, { by: userId, source, host: false });
    });
  }

  skipStar(userId: string, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "skipStar", playerId: userId, now }));
  }

  shopBuy(userId: string, itemId: string, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "shopBuy", playerId: userId, itemId, now }));
  }

  shopSkip(userId: string, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "shopSkip", playerId: userId, now }));
  }

  // Uses an item before rolling. For a Star Compass, the result is where the star
  // goes next, returned to this player only (it never goes in the event log).
  useItem(userId: string, itemId: string, targetId: string | null, source: ActionSource = "web"): Promise<{ events: StoredEvent[]; nextStar?: string }> {
    return this.enqueue(() => {
      const rt = this.boardOfPlayer(userId);
      const ctx = this.ctx(rt);
      const candidates = starCandidates(ctx, rt.state);
      const nextStarSpace = rt.state.nextStar ?? (candidates.length ? pick(this.rng, candidates) : undefined);
      const events = this.applyLocked(rt, { type: "useItem", playerId: userId, itemId, targetId, nextStarSpace, now: this.clock() }, { by: userId, source, host: false });
      const compass = ctx.rules.shop.items.find((i) => i.id === itemId)?.effect.kind === "compass";
      return compass && rt.state.nextStar ? { events, nextStar: rt.state.nextStar } : { events };
    });
  }

  pickDie(userId: string, value: number, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "pickDie", playerId: userId, value, now }));
  }

  eventTarget(userId: string, targetId: string | null, source: ActionSource = "web") {
    return this.playerAction(userId, source, (now) => ({ type: "eventTarget", playerId: userId, targetId, now }));
  }

  private playerAction(userId: string, source: ActionSource, make: (now: number) => Action): Promise<StoredEvent[]> {
    return this.enqueue(() => {
      const rt = this.boardOfPlayer(userId);
      return this.applyLocked(rt, make(this.clock()), { by: userId, source, host: false });
    });
  }

  tick(boardId: string): Promise<StoredEvent[]> {
    return this.enqueue(() => this.applyLocked(this.runtime(boardId), { type: "tick", now: this.clock() }, TIMER));
  }

  // ---- host actions ----

  hostAction(boardId: string, input: HostActionInput, by: string, source: ActionSource = "web"): Promise<StoredEvent[]> {
    return this.enqueue(() => {
      const rt = this.runtime(boardId);
      if (input.type === "addPlayer") {
        const other = this.boardIdOf(input.player.id);
        if (other) throw new EngineError("duplicate_player", `${input.player.name} is already on ${this.runtime(other).name}. Use a transfer instead.`);
      }
      return this.applyLocked(rt, { ...input, now: this.clock() } as Action, { by, source, host: true });
    });
  }

  // Undo the last `count` changes, or with turn: true, everything back to just
  // before the most recent roll. Undos themselves can't be undone.
  undo(boardId: string, opts: { count?: number; turn?: boolean }, by: string, source: ActionSource = "web"): Promise<StoredEvent[]> {
    return this.enqueue(() => {
      const rt = this.runtime(boardId);
      const stack = this.activeStack(rt);
      let count = opts.count ?? 1;
      if (opts.turn) {
        const i = stack.map((e) => e.action.type).lastIndexOf("roll");
        if (i < 0) throw new EngineError("invalid_amount", "There's no roll to undo.");
        count = stack.length - i;
      }
      if (!Number.isInteger(count) || count < 1 || count > stack.length) {
        throw new EngineError("invalid_amount", `There ${stack.length === 1 ? "is" : "are"} only ${stack.length} change(s) to undo.`);
      }
      const restored = stack[stack.length - count].before;
      const out = this.commit(rt, { kind: "undo", by, count, state: restored }, restored, [{ type: "Undone", count }], { by, source, host: true });
      this.schedule(rt);
      this.emit("reset", rt.id, rt.state, rt.seq);
      return out;
    });
  }

  private activeStack(rt: BoardRuntime) {
    const stack: Extract<LogEntry, { kind: "action" }>[] = [];
    for (const e of rt.entries) {
      if (e.kind === "action") stack.push(e);
      else if (e.kind === "undo") stack.splice(stack.length - e.count, e.count);
      else stack.length = 0;
    }
    return stack;
  }

  // Moves a player to another board. They keep coins, stars and items, except on the
  // way to Redemption Island, where everything resets.
  transfer(
    playerId: string,
    toBoardId: string,
    by: string,
    opts: { name?: string; reset?: boolean; source?: ActionSource } = {},
  ): Promise<{ from: string | null; to: string; player: PlayerState }> {
    return this.enqueue(() => {
      const to = this.runtime(toBoardId);
      const fromId = this.boardIdOf(playerId);
      if (fromId === to.id) throw new EngineError("duplicate_player", "They're already on that board.");
      const config = this.opts.loadConfig();
      const reset = opts.reset ?? to.id === REDEMPTION_ISLAND_ID;
      const existing = fromId ? this.runtime(fromId).state.players[playerId] : null;
      const name = existing?.name ?? opts.name;
      if (!name) throw new EngineError("unknown_player", "That player isn't on any board, so they need a name.");
      // Validate the add before removing anything, so a failure can't strand the player.
      const carried = reset
        ? { id: playerId, name, coins: config.redemptionIsland.resetCoins, stars: 0, items: [] as string[] }
        : { id: playerId, name, coins: existing?.coins, stars: existing?.stars, items: existing?.items };
      apply(this.ctx(to), to.state, { type: "addPlayer", player: carried, now: this.clock() });
      const meta: ActionMeta = { by, source: opts.source ?? "web", host: true };
      if (fromId) this.applyLocked(this.runtime(fromId), { type: "removePlayer", playerId, now: this.clock() }, meta);
      this.applyLocked(to, { type: "addPlayer", player: carried, now: this.clock() }, meta);
      return { from: fromId, to: to.id, player: to.state.players[playerId] };
    });
  }
}

export type { StoredEvent, WireEvent, EngineEvent };

import type { Space } from "@everest/board-data";
import { EngineError } from "./errors";
import type {
  Action,
  ActionResult,
  BoardState,
  ChoiceKind,
  CoinReason,
  EngineContext,
  EngineEvent,
  EventChoiceKind,
  MoveState,
  PlayerState,
} from "./types";

const HOUR = 3_600_000;
const MINUTE = 60_000;
// Upper bound on timeout catch-up iterations, so a corrupt state can't hang the server.
const MAX_CATCH_UP = 10_000;

export interface NewPlayer {
  id: string;
  name: string;
  coins?: number;
  stars?: number;
  items?: string[];
}

// Builds a fresh, not-yet-started board. Players start on the layout's start space.
export function createBoardState(
  ctx: EngineContext,
  opts: { boardId: string; starSpace: string | null; players: NewPlayer[] },
): BoardState {
  const state: BoardState = {
    boardId: opts.boardId,
    layoutId: ctx.layout.id,
    started: false,
    paused: false,
    pausedAt: null,
    star: null,
    players: {},
    turn: { order: [], index: 0, windowOpensAt: null, deadline: null },
    move: null,
  };
  if (opts.starSpace !== null) {
    assertStarSpace(ctx, opts.starSpace, null);
    state.star = opts.starSpace;
  }
  for (const p of opts.players) {
    if (state.players[p.id]) throw new EngineError("duplicate_player", `${p.name} is already on this board.`);
    state.players[p.id] = toPlayerState(ctx, p, ctx.layout.startSpace);
    state.turn.order.push(p.id);
  }
  return state;
}

// Applies one action. Never mutates `state`; on error it throws EngineError and the
// caller's state is untouched.
export function apply(ctx: EngineContext, state: BoardState, action: Action): ActionResult {
  const r = new Run(ctx, structuredClone(state), action.now);
  switch (action.type) {
    case "startBoard":
      r.startBoard();
      break;
    case "tick":
      r.catchUp();
      break;
    case "roll":
      r.roll(action.playerId, action.dice);
      break;
    case "chooseFork":
      r.chooseFork(action.playerId, action.next);
      break;
    case "buyStar":
      r.buyStar(action.playerId, action.newStarSpace);
      break;
    case "skipStar":
      r.skipStar(action.playerId);
      break;
    case "shopBuy":
      r.shopBuy(action.playerId, action.itemId);
      break;
    case "shopSkip":
      r.shopSkip(action.playerId);
      break;
    case "drawEvent":
      r.drawEvent(action.playerId, action.event, action.percent);
      break;
    case "eventTarget":
      r.eventTarget(action.playerId, action.targetId);
      break;
    case "setCoins":
      r.setCoins(action.playerId, action.coins);
      break;
    case "setStars":
      r.setStars(action.playerId, action.stars);
      break;
    case "grantItem":
      r.grantItem(action.playerId, action.itemId);
      break;
    case "removeItem":
      r.removeItem(action.playerId, action.itemId);
      break;
    case "movePlayer":
      r.movePlayer(action.playerId, action.spaceId);
      break;
    case "moveStar":
      r.moveStar(action.spaceId);
      break;
    case "addPlayer":
      r.addPlayer(action.player, action.spaceId);
      break;
    case "removePlayer":
      r.removePlayer(action.playerId);
      break;
    case "setTurnOrder":
      r.setTurnOrder(action.order);
      break;
    case "openTurnNow":
      r.openTurnNow();
      break;
    case "skipTurn":
      r.skipTurn();
      break;
    case "pause":
      r.pause();
      break;
    case "resume":
      r.resume();
      break;
    default: {
      const never: never = action;
      throw new Error(`unknown action ${(never as { type: string }).type}`);
    }
  }
  return { state: r.s, events: r.events };
}

// ---- queries (read-only helpers for the server and UIs) ----

export function currentPlayerId(state: BoardState): string | null {
  return state.turn.order[state.turn.index] ?? null;
}

// Spaces the star may move to when it's bought: any space of an allowed type except
// the one it's on now. The server picks one at random and passes it to buyStar.
export function starCandidates(ctx: EngineContext, state: BoardState): string[] {
  return ctx.layout.spaces
    .filter((s) => ctx.rules.star.spawnOn.includes(s.type) && s.id !== state.star)
    .map((s) => s.id);
}

// Events the server may draw on an event space (weight above 0).
export function enabledEvents(ctx: EngineContext): { event: EventChoiceKind; weight: number }[] {
  const e = ctx.rules.events;
  return (["coinSteal", "starSteal", "swap"] as const).map((event) => ({ event, weight: e[event].weight })).filter((x) => x.weight > 0);
}

// The enabled events that would actually do something for this player right now:
// steals and swaps need a tribemate, and a star steal needs someone with a star and
// enough coins to pay. The server draws from these, so an event space never lands on
// one that just fizzles. Empty when nothing can happen (e.g. alone on the board).
export function possibleEvents(ctx: EngineContext, state: BoardState, playerId: string): { event: EventChoiceKind; weight: number }[] {
  const others = state.turn.order.filter((id) => id !== playerId && state.players[id]);
  const coins = state.players[playerId]?.coins ?? 0;
  return enabledEvents(ctx).filter(({ event }) => {
    if (!others.length) return false;
    if (event === "starSteal") return coins >= ctx.rules.events.starSteal.price && others.some((id) => state.players[id].stars > 0);
    return true;
  });
}

export function affordableItems(ctx: EngineContext, coins: number): string[] {
  return ctx.rules.shop.items.filter((i) => i.price <= coins).map((i) => i.id);
}

// ---- internals ----

function toPlayerState(ctx: EngineContext, p: NewPlayer, space: string): PlayerState {
  return {
    id: p.id,
    name: p.name,
    space,
    coins: p.coins ?? ctx.rules.coins.starting,
    stars: p.stars ?? 0,
    items: [...(p.items ?? [])],
  };
}

function assertStarSpace(ctx: EngineContext, spaceId: string, current: string | null) {
  const space = ctx.layout.spaces.find((s) => s.id === spaceId);
  if (!space || !ctx.rules.star.spawnOn.includes(space.type) || spaceId === current) {
    throw new EngineError("invalid_star_space", `The star can't go on ${spaceId}.`);
  }
}

function formatWait(ms: number): string {
  const mins = Math.ceil(ms / MINUTE);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

class Run {
  readonly events: EngineEvent[] = [];
  private readonly spaces: Map<string, Space>;

  constructor(
    private readonly ctx: EngineContext,
    readonly s: BoardState,
    private readonly now: number,
  ) {
    this.spaces = new Map(ctx.layout.spaces.map((sp) => [sp.id, sp]));
  }

  private emit(e: EngineEvent) {
    this.events.push(e);
  }

  private space(id: string): Space {
    const sp = this.spaces.get(id);
    if (!sp) throw new EngineError("invalid_space", `There's no space ${id} on this board.`);
    return sp;
  }

  private player(id: string): PlayerState {
    const p = this.s.players[id];
    if (!p) throw new EngineError("unknown_player", "That player isn't on this board.");
    return p;
  }

  private requireLive() {
    if (!this.s.started) throw new EngineError("not_started", "The board hasn't started yet.");
    if (this.s.paused) throw new EngineError("paused", "The board is paused right now.");
  }

  private changeCoins(p: PlayerState, delta: number, reason: CoinReason) {
    const next = Math.max(this.ctx.rules.coins.floor, p.coins + delta);
    const actual = next - p.coins;
    p.coins = next;
    this.emit({ type: "CoinsChanged", playerId: p.id, delta: actual, coins: p.coins, reason });
  }

  private changeStars(p: PlayerState, delta: number, reason: "star" | "event" | "host") {
    const next = Math.max(0, p.stars + delta);
    const actual = next - p.stars;
    p.stars = next;
    this.emit({ type: "StarsChanged", playerId: p.id, delta: actual, stars: p.stars, reason });
  }

  private choiceExpiry(): number {
    return this.now + this.ctx.rules.turns.choiceTimeoutMinutes * MINUTE;
  }

  // ---- turns ----

  private openWindow(opensAt: number, unlimited = false) {
    const t = this.s.turn;
    if (!t.order.length) {
      t.windowOpensAt = null;
      t.deadline = null;
      return;
    }
    t.windowOpensAt = opensAt;
    t.deadline = unlimited ? null : opensAt + this.ctx.rules.turns.windowHours * HOUR;
    this.emit({ type: "TurnStarted", playerId: t.order[t.index], windowOpensAt: t.windowOpensAt, deadline: t.deadline });
  }

  private advanceTurn(opensAt: number) {
    const t = this.s.turn;
    if (t.order.length) t.index = (t.index + 1) % t.order.length;
    this.openWindow(opensAt);
  }

  // Applies every timeout that has passed by `now`: expired prompts take their
  // default, expired turn windows are skipped. Deterministic for a given `now`.
  catchUp() {
    if (!this.s.started || this.s.paused) return;
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const m = this.s.move;
      const c = m?.choice;
      if (m && c && c.kind !== "eventDraw" && this.now >= c.expiresAt) {
        if (c.kind === "fork") this.resolveFork(c.options[0], true);
        else if (c.kind === "star") this.resolveSkipStar(true);
        else if (c.kind === "shop") this.closeShop(true);
        else if (c.kind === "coinSteal") {
          // Stealing only helps, so a timeout takes from the richest tribemate.
          const targets = c.targets.filter((id) => this.s.players[id]);
          if (targets.length) {
            const richest = targets.reduce((a, b) => (this.s.players[b].coins > this.s.players[a].coins ? b : a));
            this.resolveEventTarget(richest, true);
          } else this.fizzle("coinSteal", "no_targets");
        } else this.declineEvent(true);
        continue;
      }
      const t = this.s.turn;
      if (!m && t.deadline !== null && this.now >= t.deadline && t.order.length) {
        // After a very long outage, jump over whole missed rounds at once (they
        // change nothing but the clock) instead of skipping them one by one.
        const windowMs = this.ctx.rules.turns.windowHours * HOUR;
        const missed = windowMs > 0 ? Math.floor((this.now - t.deadline) / windowMs) : 0;
        const rounds = Math.floor(missed / t.order.length);
        if (rounds > 0) {
          t.deadline += rounds * t.order.length * windowMs;
          if (t.windowOpensAt !== null) t.windowOpensAt += rounds * t.order.length * windowMs;
        }
        const deadline = t.deadline;
        this.emit({ type: "TurnSkipped", playerId: t.order[t.index] });
        // The next window opens the moment the missed one closed, with no cooldown.
        this.advanceTurn(deadline);
        continue;
      }
      return;
    }
    throw new Error("catchUp did not settle");
  }

  startBoard() {
    if (this.s.started) throw new EngineError("already_started", "The board has already started.");
    if (!this.s.turn.order.length) throw new EngineError("invalid_order", "Add players before starting the board.");
    this.s.started = true;
    this.s.turn.index = 0;
    this.emit({ type: "BoardStarted", order: [...this.s.turn.order] });
    this.openWindow(this.now, this.ctx.rules.turns.firstTurnUnlimited);
  }

  pause() {
    this.requireLive();
    this.catchUp();
    this.s.paused = true;
    this.s.pausedAt = this.now;
    this.emit({ type: "BoardPaused" });
  }

  resume() {
    if (!this.s.paused || this.s.pausedAt === null) throw new EngineError("paused", "The board isn't paused.");
    // Freeze every clock for the length of the pause.
    const shift = this.now - this.s.pausedAt;
    const t = this.s.turn;
    if (t.windowOpensAt !== null) t.windowOpensAt += shift;
    if (t.deadline !== null) t.deadline += shift;
    if (this.s.move) {
      this.s.move.rolledAt += shift;
      const c = this.s.move.choice;
      if (c && c.kind !== "eventDraw") c.expiresAt += shift;
    }
    this.s.paused = false;
    this.s.pausedAt = null;
    this.emit({ type: "BoardResumed" });
  }

  // ---- movement ----

  roll(playerId: string, dice: number[]) {
    this.catchUp();
    this.requireLive();
    const p = this.player(playerId);
    if (this.s.move) throw new EngineError("busy", "Someone is still finishing their turn.");
    const t = this.s.turn;
    if (t.order[t.index] !== playerId) throw new EngineError("not_your_turn", "It isn't your turn yet.");
    if (t.windowOpensAt !== null && this.now < t.windowOpensAt) {
      throw new EngineError("cooldown", `Your turn opens in ${formatWait(t.windowOpensAt - this.now)}.`);
    }
    const { min, max } = this.ctx.rules.dice;
    if (!dice.length || dice.some((d) => !Number.isInteger(d) || d < min || d > max)) {
      throw new EngineError("invalid_dice", `Dice must be whole numbers from ${min} to ${max}.`);
    }
    const total = dice.reduce((a, b) => a + b, 0);
    this.emit({ type: "DiceRolled", playerId, dice: [...dice], total });
    this.s.move = { playerId: p.id, remaining: total, rolledAt: this.now, arrival: null, choice: null };
    if (total === 0) this.s.move.arrival = { spaceId: p.space, starDone: true, shopDone: true };
    this.continueMove();
  }

  private requireChoice<K extends ChoiceKind>(playerId: string, kind: K) {
    this.catchUp();
    this.requireLive();
    const m = this.s.move;
    if (!m || m.playerId !== playerId || !m.choice) {
      throw new EngineError("no_pending_choice", "You don't have anything to choose right now.");
    }
    if (m.choice.kind !== kind) throw new EngineError("wrong_choice", "That isn't the choice you're on.");
    return { m, choice: m.choice as Extract<NonNullable<MoveState["choice"]>, { kind: K }> };
  }

  private step(to: string) {
    const m = this.s.move!;
    const p = this.player(m.playerId);
    const from = p.space;
    p.space = to;
    m.remaining--;
    this.emit({ type: "PlayerMoved", playerId: p.id, from, to, remaining: m.remaining });
    m.arrival = { spaceId: to, starDone: false, shopDone: false };
  }

  // Walks the token until it finishes or hits a choice. Re-entered after every choice.
  private continueMove() {
    const m = this.s.move!;
    const p = this.player(m.playerId);
    for (;;) {
      if (m.arrival) {
        const sp = this.space(m.arrival.spaceId);
        const final = m.remaining === 0;
        if (!m.arrival.starDone) {
          m.arrival.starDone = true;
          if (this.s.star === sp.id) {
            if (!final) this.emit({ type: "PassedSpace", playerId: p.id, spaceId: sp.id, spaceType: sp.type });
            const price = this.ctx.rules.star.price;
            if (p.coins >= price) {
              m.choice = { kind: "star", spaceId: sp.id, price, expiresAt: this.choiceExpiry() };
              this.emit({ type: "StarOffered", playerId: p.id, spaceId: sp.id, price });
              return;
            }
            this.emit({ type: "StarUnaffordable", playerId: p.id, spaceId: sp.id, price, coins: p.coins });
          }
        }
        if (!m.arrival.shopDone) {
          m.arrival.shopDone = true;
          if (sp.type === "shop" && (final || sp.passEffect)) {
            if (!final) this.emit({ type: "PassedSpace", playerId: p.id, spaceId: sp.id, spaceType: sp.type });
            const affordable = affordableItems(this.ctx, p.coins);
            if (affordable.length) {
              m.choice = { kind: "shop", spaceId: sp.id, bought: 0, expiresAt: this.choiceExpiry() };
              this.emit({ type: "ShopOpened", playerId: p.id, spaceId: sp.id, affordable });
              return;
            }
            this.emit({ type: "ShopUnaffordable", playerId: p.id, spaceId: sp.id });
          }
        }
        if (final) {
          this.land(sp);
          return;
        }
        m.arrival = null;
      }
      const cur = this.space(p.space);
      if (cur.next.length > 1) {
        m.choice = { kind: "fork", spaceId: cur.id, options: [...cur.next], expiresAt: this.choiceExpiry() };
        this.emit({ type: "ForkChoiceRequired", playerId: p.id, spaceId: cur.id, options: [...cur.next], remaining: m.remaining });
        return;
      }
      this.step(cur.next[0]);
    }
  }

  private land(sp: Space) {
    const m = this.s.move!;
    const p = this.player(m.playerId);
    this.emit({ type: "LandedOnSpace", playerId: p.id, spaceId: sp.id, spaceType: sp.type });
    const coins = this.ctx.rules.coins;
    if (sp.type === "blue") this.changeCoins(p, coins.blue, "blue");
    else if (sp.type === "red") this.changeCoins(p, coins.red, "red");
    else if (sp.type === "green" && coins.green !== 0) this.changeCoins(p, coins.green, "green");
    else if (sp.type === "event") {
      if (enabledEvents(this.ctx).length) {
        // The server sees this and draws the event with drawEvent.
        m.choice = { kind: "eventDraw", spaceId: sp.id };
        return;
      }
      this.emit({ type: "EventFizzled", playerId: p.id, event: null, reason: "no_events" });
    }
    this.finishMove();
  }

  private finishMove() {
    const m = this.s.move!;
    this.s.move = null;
    this.emit({ type: "TurnEnded", playerId: m.playerId });
    // The cooldown runs from the moment of the roll, not the end of the move.
    this.advanceTurn(m.rolledAt + this.ctx.rules.turns.cooldownHours * HOUR);
  }

  chooseFork(playerId: string, next: string) {
    const { choice } = this.requireChoice(playerId, "fork");
    if (!choice.options.includes(next)) throw new EngineError("wrong_choice", "That path isn't one of the options.");
    this.resolveFork(next, false);
  }

  private resolveFork(next: string, auto: boolean) {
    const m = this.s.move!;
    const c = m.choice as Extract<NonNullable<MoveState["choice"]>, { kind: "fork" }>;
    m.choice = null;
    this.emit({ type: "ForkChosen", playerId: m.playerId, spaceId: c.spaceId, next, auto });
    this.step(next);
    this.continueMove();
  }

  buyStar(playerId: string, newStarSpace: string) {
    const { m, choice } = this.requireChoice(playerId, "star");
    const p = this.player(playerId);
    if (p.coins < choice.price) throw new EngineError("not_enough_coins", "You don't have enough coins for the star.");
    assertStarSpace(this.ctx, newStarSpace, this.s.star);
    this.changeCoins(p, -choice.price, "star");
    this.changeStars(p, 1, "star");
    this.emit({ type: "StarPurchased", playerId, spaceId: choice.spaceId, price: choice.price });
    const from = this.s.star;
    this.s.star = newStarSpace;
    this.emit({ type: "StarMoved", from, to: newStarSpace, by: "purchase" });
    m.choice = null;
    this.continueMove();
  }

  skipStar(playerId: string) {
    this.requireChoice(playerId, "star");
    this.resolveSkipStar(false);
  }

  private resolveSkipStar(auto: boolean) {
    const m = this.s.move!;
    m.choice = null;
    this.emit({ type: "StarSkipped", playerId: m.playerId, auto });
    this.continueMove();
  }

  shopBuy(playerId: string, itemId: string) {
    const { choice } = this.requireChoice(playerId, "shop");
    const p = this.player(playerId);
    const item = this.ctx.rules.shop.items.find((i) => i.id === itemId);
    if (!item) throw new EngineError("unknown_item", "That item isn't in the shop.");
    if (p.coins < item.price) throw new EngineError("not_enough_coins", `You need ${item.price} coins for ${item.name}.`);
    this.changeCoins(p, -item.price, "shop");
    p.items.push(item.id);
    this.emit({ type: "ShopPurchase", playerId, itemId: item.id, price: item.price });
    choice.bought++;
    if (choice.bought >= this.ctx.rules.shop.maxPerVisit || !affordableItems(this.ctx, p.coins).length) {
      this.closeShop(false);
    }
  }

  shopSkip(playerId: string) {
    this.requireChoice(playerId, "shop");
    this.closeShop(false);
  }

  private closeShop(auto: boolean) {
    const m = this.s.move!;
    m.choice = null;
    this.emit({ type: "ShopClosed", playerId: m.playerId, auto });
    this.continueMove();
  }

  // ---- event spaces ----

  drawEvent(playerId: string, event: EventChoiceKind, percent: number) {
    const { m, choice } = this.requireChoice(playerId, "eventDraw");
    const p = this.player(playerId);
    const rules = this.ctx.rules.events;
    if (!(event in rules)) throw new EngineError("wrong_choice", "That isn't an event.");
    const others = this.s.turn.order.filter((id) => id !== playerId && this.s.players[id]);
    const targets = event === "starSteal" ? others.filter((id) => this.s.players[id].stars > 0) : others;
    this.emit({ type: "EventDrawn", playerId, spaceId: choice.spaceId, event, targets });
    m.choice = null;
    if (!others.length) return this.fizzle(event, "no_targets");
    const expiresAt = this.choiceExpiry();
    if (event === "coinSteal") {
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new EngineError("invalid_amount", "The steal percentage must be 0-100.");
      m.choice = { kind: "coinSteal", spaceId: choice.spaceId, targets, percent, expiresAt };
    } else if (event === "starSteal") {
      const price = rules.starSteal.price;
      if (!targets.length) return this.fizzle(event, "no_stars");
      if (p.coins < price) return this.fizzle(event, "too_poor", price);
      m.choice = { kind: "starSteal", spaceId: choice.spaceId, targets, price, expiresAt };
    } else {
      m.choice = { kind: "swap", spaceId: choice.spaceId, targets, expiresAt };
    }
  }

  // The player picks who the event hits, or null to pass (star steal and swap only).
  eventTarget(playerId: string, targetId: string | null) {
    this.catchUp();
    this.requireLive();
    const c = this.s.move?.playerId === playerId ? this.s.move.choice : null;
    if (!c || (c.kind !== "coinSteal" && c.kind !== "starSteal" && c.kind !== "swap")) {
      throw new EngineError("no_pending_choice", "You don't have an event to resolve right now.");
    }
    if (targetId === null) {
      if (c.kind === "coinSteal") throw new EngineError("wrong_choice", "Pick someone to steal from.");
      return this.declineEvent(false);
    }
    if (!c.targets.includes(targetId) || !this.s.players[targetId]) throw new EngineError("wrong_choice", "You can't pick that player.");
    this.resolveEventTarget(targetId, false);
  }

  private resolveEventTarget(targetId: string, auto: boolean) {
    const m = this.s.move!;
    const c = m.choice!;
    const p = this.player(m.playerId);
    const t = this.player(targetId);
    if (c.kind === "coinSteal") {
      const amount = Math.floor((t.coins * c.percent) / 100);
      this.emit({ type: "CoinsStolen", playerId: p.id, targetId, percent: c.percent, amount, auto });
      this.changeCoins(t, -amount, "event");
      this.changeCoins(p, amount, "event");
    } else if (c.kind === "starSteal") {
      if (t.stars < 1) throw new EngineError("wrong_choice", `${t.name} doesn't have a star anymore.`);
      if (p.coins < c.price) throw new EngineError("not_enough_coins", `You need ${c.price} coins to steal a star.`);
      this.emit({ type: "StarStolen", playerId: p.id, targetId, price: c.price });
      this.changeCoins(p, -c.price, "event");
      this.changeStars(t, -1, "event");
      this.changeStars(p, 1, "event");
    } else if (c.kind === "swap") {
      const mine = p.space;
      p.space = t.space;
      t.space = mine;
      this.emit({ type: "PlayersSwapped", playerId: p.id, targetId, playerTo: p.space, targetTo: t.space });
    }
    m.choice = null;
    this.finishMove();
  }

  private declineEvent(auto: boolean) {
    const m = this.s.move!;
    const kind = m.choice!.kind as EventChoiceKind;
    m.choice = null;
    this.emit({ type: "EventDeclined", playerId: m.playerId, event: kind, auto });
    this.finishMove();
  }

  private fizzle(event: EventChoiceKind, reason: "no_targets" | "no_stars" | "too_poor", price?: number) {
    const m = this.s.move!;
    m.choice = null;
    this.emit({ type: "EventFizzled", playerId: m.playerId, event, reason, ...(price !== undefined ? { price } : {}) });
    this.finishMove();
  }

  // ---- host actions ----

  private requireAmount(n: number) {
    if (!Number.isInteger(n) || n < 0) throw new EngineError("invalid_amount", "Amounts must be whole numbers, 0 or more.");
  }

  setCoins(playerId: string, coins: number) {
    this.requireAmount(coins);
    const p = this.player(playerId);
    this.changeCoins(p, coins - p.coins, "host");
  }

  setStars(playerId: string, stars: number) {
    this.requireAmount(stars);
    const p = this.player(playerId);
    this.changeStars(p, stars - p.stars, "host");
  }

  grantItem(playerId: string, itemId: string) {
    const p = this.player(playerId);
    if (!this.ctx.rules.shop.items.some((i) => i.id === itemId)) {
      throw new EngineError("unknown_item", `There's no item ${itemId} in the config.`);
    }
    p.items.push(itemId);
    this.emit({ type: "ItemGranted", playerId, itemId });
  }

  removeItem(playerId: string, itemId: string) {
    const p = this.player(playerId);
    const i = p.items.indexOf(itemId);
    if (i < 0) throw new EngineError("unknown_item", `${p.name} doesn't have ${itemId}.`);
    p.items.splice(i, 1);
    this.emit({ type: "ItemRemoved", playerId, itemId });
  }

  movePlayer(playerId: string, spaceId: string) {
    const p = this.player(playerId);
    this.space(spaceId);
    if (this.s.move?.playerId === playerId) {
      throw new EngineError("busy", `${p.name} is mid-move. Let it finish or undo it first.`);
    }
    const from = p.space;
    p.space = spaceId;
    this.emit({ type: "PlayerTeleported", playerId, from, to: spaceId });
  }

  moveStar(spaceId: string) {
    assertStarSpace(this.ctx, spaceId, this.s.star);
    const from = this.s.star;
    this.s.star = spaceId;
    this.emit({ type: "StarMoved", from, to: spaceId, by: "host" });
  }

  addPlayer(np: NewPlayer, spaceId?: string) {
    if (this.s.players[np.id]) throw new EngineError("duplicate_player", `${np.name} is already on this board.`);
    const space = spaceId ?? this.ctx.layout.startSpace;
    this.space(space);
    this.s.players[np.id] = toPlayerState(this.ctx, np, space);
    const t = this.s.turn;
    t.order.push(np.id);
    this.emit({ type: "PlayerAdded", playerId: np.id, spaceId: space });
    // A board that had nobody left gets its turn clock back.
    if (this.s.started && t.order.length === 1) {
      t.index = 0;
      this.openWindow(this.now);
    }
  }

  removePlayer(playerId: string) {
    const p = this.player(playerId);
    const t = this.s.turn;
    const idx = t.order.indexOf(playerId);
    const wasCurrent = idx === t.index;
    if (this.s.move?.playerId === playerId) this.s.move = null;
    t.order.splice(idx, 1);
    delete this.s.players[playerId];
    this.emit({ type: "PlayerRemoved", playerId, player: p });
    if (idx < t.index) t.index--;
    if (t.index >= t.order.length) t.index = 0;
    if (this.s.started && wasCurrent) this.openWindow(Math.max(this.now, t.windowOpensAt ?? this.now));
    if (!t.order.length) {
      t.windowOpensAt = null;
      t.deadline = null;
    }
  }

  openTurnNow() {
    this.requireLive();
    if (this.s.move) throw new EngineError("busy", "Someone is mid-move. Let it finish first.");
    if (!this.s.turn.order.length) throw new EngineError("invalid_order", "There's nobody on this board.");
    this.openWindow(this.now);
  }

  skipTurn() {
    this.requireLive();
    if (this.s.move) throw new EngineError("busy", "Someone is mid-move. Let it finish or undo it first.");
    const t = this.s.turn;
    if (!t.order.length) throw new EngineError("invalid_order", "There's nobody on this board.");
    this.emit({ type: "TurnSkipped", playerId: t.order[t.index], byHost: true });
    this.advanceTurn(this.now);
  }

  setTurnOrder(order: string[]) {
    const t = this.s.turn;
    const same = order.length === t.order.length && new Set(order).size === order.length && order.every((id) => t.order.includes(id));
    if (!same) throw new EngineError("invalid_order", "The new order must list every player on this board exactly once.");
    if (this.s.move) throw new EngineError("busy", "Wait for the current move to finish.");
    // The player whose turn it is keeps it; only the sequence after them changes.
    const current = t.order[t.index];
    t.order = [...order];
    t.index = this.s.started ? t.order.indexOf(current) : 0;
    this.emit({ type: "TurnOrderSet", order: [...order] });
  }
}

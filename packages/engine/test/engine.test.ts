import { describe, expect, it } from "vitest";
import { loadLayouts } from "@everest/board-data";
import { EngineError, replay, undo, undoTurn, type EngineEvent } from "../src";
import { ctxFor, Game, HOUR, lineLayout, T0, types } from "./helpers";

const main = loadLayouts().main;

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

function started(...args: ConstructorParameters<typeof Game>) {
  const g = new Game(...args);
  g.start();
  return g;
}

describe("space effects on landing", () => {
  it("blue gives +3", () => {
    const g = started(ctxFor());
    const ev = g.roll("alice", 1);
    expect(g.p("alice").space).toBe("s02");
    expect(g.p("alice").coins).toBe(13);
    expect(ev).toContainEqual({ type: "CoinsChanged", playerId: "alice", delta: 3, coins: 13, reason: "blue" });
  });

  it("red takes 3", () => {
    const g = started(ctxFor());
    g.roll("alice", 2);
    expect(g.p("alice").coins).toBe(7);
  });

  it("red never takes coins below 0", () => {
    const g = started(ctxFor());
    g.setup("alice", "s01", 2);
    const ev = g.roll("alice", 2);
    expect(g.p("alice").coins).toBe(0);
    expect(ev).toContainEqual({ type: "CoinsChanged", playerId: "alice", delta: -2, coins: 0, reason: "red" });
  });

  it("green does nothing", () => {
    const g = started(ctxFor());
    const ev = g.roll("alice", 3);
    expect(g.p("alice").coins).toBe(10);
    expect(types(ev)).not.toContain("CoinsChanged");
    expect(types(ev)).toContain("LandedOnSpace");
  });

  it("start does nothing", () => {
    const g = started(ctxFor());
    g.setup("alice", "s09");
    const ev = g.roll("alice", 1);
    expect(g.p("alice").space).toBe("s01");
    expect(types(ev)).not.toContain("CoinsChanged");
  });

  it("bowser with an empty wheel just reports it", () => {
    const g = started(ctxFor());
    g.setup("alice", "s04");
    const ev = g.roll("alice", 2); // passes the shop (skip below), lands on bowser
    expect(types(ev)).toContain("ShopOpened");
    const ev2 = g.do({ type: "shopSkip", playerId: "alice", now: g.now });
    expect(types(ev2)).toContain("BowserNoWheel");
    expect(g.state.move).toBeNull();
  });

  it("bowser with a wheel waits for the server's spin, then applies it", () => {
    const g = started(
      ctxFor(lineLayout, { bowser: { wheel: [{ id: "tax", label: "Bowser tax", weight: 1, coins: -5, stars: 0 }] } }),
    );
    g.setup("alice", "s05");
    const ev = g.roll("alice", 1);
    expect(types(ev)).toContain("BowserSpinRequired");
    expect(g.state.move?.choice?.kind).toBe("bowser");
    const ev2 = g.do({ type: "spinBowser", playerId: "alice", outcomeId: "tax", now: g.now });
    expect(g.p("alice").coins).toBe(5);
    expect(types(ev2)).toEqual(["BowserSpin", "CoinsChanged", "TurnEnded", "TurnStarted"]);
  });

  it("bowser only triggers on landing, not passing", () => {
    const g = started(
      ctxFor(lineLayout, { bowser: { wheel: [{ id: "tax", label: "Bowser tax", weight: 1, coins: -5, stars: 0 }] } }),
    );
    g.setup("alice", "s05");
    const ev = g.roll("alice", 2); // passes s06 bowser, lands on s07 fork... s07 is the landing
    expect(types(ev)).not.toContain("BowserSpinRequired");
    expect(g.p("alice").space).toBe("s07");
  });
});

describe("forks", () => {
  it("pauses at a fork and resumes with the remaining steps", () => {
    const g = started(ctxFor());
    g.setup("alice", "s06");
    const ev = g.roll("alice", 3);
    expect(ev[ev.length - 1]).toEqual({ type: "ForkChoiceRequired", playerId: "alice", spaceId: "s07", options: ["s08", "s10"], remaining: 2 });
    g.do({ type: "chooseFork", playerId: "alice", next: "s10", now: g.now });
    expect(g.p("alice").space).toBe("s01");
    expect(g.state.move).toBeNull();
  });

  it("asks at the very first step when the token starts on a fork", () => {
    const g = started(ctxFor());
    g.setup("alice", "s07");
    const ev = g.roll("alice", 1);
    expect(types(ev)).toEqual(["DiceRolled", "ForkChoiceRequired"]);
    g.do({ type: "chooseFork", playerId: "alice", next: "s08", now: g.now });
    expect(g.p("alice").space).toBe("s08");
  });

  it("rejects a path that isn't an option, and choices from other players", () => {
    const g = started(ctxFor());
    g.setup("alice", "s07");
    g.roll("alice", 1);
    expectError(() => g.do({ type: "chooseFork", playerId: "alice", next: "s09", now: g.now }), "wrong_choice");
    expectError(() => g.do({ type: "chooseFork", playerId: "bob", next: "s08", now: g.now }), "no_pending_choice");
  });

  it("takes the first option when the prompt times out", () => {
    const g = started(ctxFor());
    g.setup("alice", "s07");
    g.roll("alice", 1);
    g.advance(1);
    const ev = g.tick();
    expect(ev).toContainEqual({ type: "ForkChosen", playerId: "alice", spaceId: "s07", next: "s08", auto: true });
    expect(g.p("alice").space).toBe("s08");
  });
});

describe("one-way bridges on the main board", () => {
  it("top bridge carries a token left from s14 to s24", () => {
    const g = started(ctxFor(main));
    g.setup("alice", "s13", 0); // 0 coins: the shop has nothing affordable, so no pause
    const ev = g.roll("alice", 2);
    const moves = ev.filter((e): e is Extract<EngineEvent, { type: "PlayerMoved" }> => e.type === "PlayerMoved");
    expect(moves.map((m) => [m.from, m.to])).toEqual([
      ["s13", "s14"],
      ["s14", "s24"],
    ]);
  });

  it("bottom bridge carries a token right from s54 to s67", () => {
    const g = started(ctxFor(main));
    g.setup("alice", "s54");
    g.roll("alice", 1);
    expect(g.p("alice").space).toBe("s67");
  });

  it("no space on the left half leads back over a bridge the wrong way", () => {
    const edges = new Set(main.spaces.flatMap((s) => s.next.map((n) => `${s.id}>${n}`)));
    expect(edges.has("s24>s14")).toBe(false);
    expect(edges.has("s67>s54")).toBe(false);
  });
});

describe("shops", () => {
  it("passing a shop opens it, buying ends the visit, then movement resumes", () => {
    const g = started(ctxFor());
    const ev = g.roll("alice", 6); // s02..s07, passing the s05 shop
    expect(ev[ev.length - 1]).toMatchObject({ type: "ShopOpened", spaceId: "s05", affordable: ["mushroom"] });
    expect(types(ev)).toContain("PassedSpace");
    const ev2 = g.do({ type: "shopBuy", playerId: "alice", itemId: "mushroom", now: g.now });
    expect(g.p("alice").items).toEqual(["mushroom"]);
    expect(types(ev2)).toContain("ShopClosed");
    expect(g.p("alice").space).toBe("s07");
    expect(g.p("alice").coins).toBe(10 - 5 + 3);
  });

  it("landing on a shop opens it too, with no coin effect", () => {
    const g = started(ctxFor());
    g.roll("alice", 4);
    expect(g.state.move?.choice?.kind).toBe("shop");
    const ev = g.do({ type: "shopSkip", playerId: "alice", now: g.now });
    expect(types(ev)).toEqual(["ShopClosed", "LandedOnSpace", "TurnEnded", "TurnStarted"]);
    expect(g.p("alice").coins).toBe(10);
  });

  it("does not stop when nothing is affordable", () => {
    const g = started(ctxFor());
    g.setup("alice", "s01", 2);
    const ev = g.roll("alice", 6);
    expect(types(ev)).toContain("ShopUnaffordable");
    expect(g.state.move).toBeNull();
  });

  it("rejects items the player can't afford", () => {
    const g = started(ctxFor());
    g.roll("alice", 4);
    expectError(() => g.do({ type: "shopBuy", playerId: "alice", itemId: "golden-pipe", now: g.now }), "not_enough_coins");
    expectError(() => g.do({ type: "shopBuy", playerId: "alice", itemId: "nope", now: g.now }), "unknown_item");
  });

  it("a shop without passEffect only opens on landing", () => {
    const layout = structuredClone(lineLayout);
    delete layout.spaces[4].passEffect;
    const g = started(ctxFor(layout));
    const ev = g.roll("alice", 6);
    expect(types(ev)).not.toContain("ShopOpened");
  });

  it("closes itself when the prompt times out", () => {
    const g = started(ctxFor());
    g.roll("alice", 6);
    g.advance(1);
    const ev = g.tick();
    expect(ev).toContainEqual({ type: "ShopClosed", playerId: "alice", auto: true });
    expect(g.p("alice").space).toBe("s07");
  });
});

describe("star", () => {
  it("passing the star with enough coins offers it; buying moves it", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 25);
    const ev = g.roll("alice", 2);
    expect(ev[ev.length - 1]).toEqual({ type: "StarOffered", playerId: "alice", spaceId: "s02", price: 20 });
    const ev2 = g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s08", now: g.now });
    expect(g.p("alice").stars).toBe(1);
    expect(g.state.star).toBe("s08");
    expect(ev2).toContainEqual({ type: "StarMoved", from: "s02", to: "s08", by: "purchase" });
    expect(g.p("alice").space).toBe("s03");
    expect(g.p("alice").coins).toBe(25 - 20 - 3);
  });

  it("landing on the star offers it, then the blue space still pays", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 20);
    g.roll("alice", 1);
    g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s08", now: g.now });
    expect(g.p("alice").coins).toBe(3);
  });

  it("is not offered without enough coins", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    const ev = g.roll("alice", 2);
    expect(types(ev)).toContain("StarUnaffordable");
    expect(g.state.move).toBeNull();
  });

  it("can only move to a blue space other than the current one", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 30);
    g.roll("alice", 1);
    expectError(() => g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s03", now: g.now }), "invalid_star_space");
    expectError(() => g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s02", now: g.now }), "invalid_star_space");
  });

  it("skipping keeps coins and leaves the star in place", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 30);
    g.roll("alice", 2);
    g.do({ type: "skipStar", playerId: "alice", now: g.now });
    expect(g.state.star).toBe("s02");
    expect(g.p("alice").stars).toBe(0);
  });
});

describe("several players", () => {
  it("can share a space", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    g.advance(4);
    g.roll("bob", 1);
    expect(g.p("alice").space).toBe("s02");
    expect(g.p("bob").space).toBe("s02");
  });
});

describe("turn rules", () => {
  it("only the current player can roll", () => {
    const g = started(ctxFor());
    expectError(() => g.roll("bob", 3), "not_your_turn");
  });

  it("the next player waits out the 4h cooldown from the roll", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    expectError(() => g.roll("alice", 1), "not_your_turn");
    g.advance(3.5);
    expectError(() => g.roll("bob", 1), "cooldown");
    g.advance(0.5);
    g.roll("bob", 1);
  });

  it("the first turn has no time limit", () => {
    const g = started(ctxFor());
    expect(g.state.turn.deadline).toBeNull();
    g.advance(24 * 30);
    expect(types(g.tick())).toEqual([]);
    g.roll("alice", 1);
  });

  it("a missed 12h window skips to the next player with no cooldown", () => {
    const g = started(ctxFor());
    g.roll("alice", 1); // bob's window: T0+4h .. T0+16h
    g.advance(16);
    const ev = g.tick();
    expect(ev).toEqual([
      { type: "TurnSkipped", playerId: "bob" },
      { type: "TurnStarted", playerId: "cara", windowOpensAt: T0 + 16 * HOUR, deadline: T0 + 28 * HOUR },
    ]);
    g.roll("cara", 1);
  });

  it("skips several missed windows in one catch-up and wraps the order", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    g.advance(4 + 12 * 3);
    const ev = g.tick();
    expect(types(ev)).toEqual(["TurnSkipped", "TurnStarted", "TurnSkipped", "TurnStarted", "TurnSkipped", "TurnStarted"]);
    expect(g.state.turn.order[g.state.turn.index]).toBe("bob");
  });

  it("catches up after a very long outage without looping forever", () => {
    const g = started(ctxFor());
    g.roll("alice", 1); // bob's window: T0+4h .. T0+16h
    g.advance(4 + 12 * 3000 + 1); // 3000 missed windows later (1000 full rounds)
    g.tick();
    // 3000 skips from bob lands back on bob (3000 % 3 === 0), mid-window.
    expect(g.state.turn.order[g.state.turn.index]).toBe("bob");
    expect(g.state.turn.deadline).toBe(T0 + (4 + 12 * 3001) * HOUR);
  });

  it("rolling applies overdue skips first, so a late roll is rejected", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    g.advance(17);
    expectError(() => g.roll("bob", 1), "not_your_turn");
  });

  it("the cooldown starts at the roll even if choices take a while", () => {
    const g = started(ctxFor());
    g.roll("alice", 4); // lands on the shop
    g.advance(0.5);
    g.do({ type: "shopSkip", playerId: "alice", now: g.now });
    expect(g.state.turn.windowOpensAt).toBe(T0 + 4 * HOUR);
  });

  it("rejects dice outside the configured range", () => {
    const g = started(ctxFor());
    expectError(() => g.roll("alice", 11), "invalid_dice");
    expectError(() => g.roll("alice", 0), "invalid_dice");
    expectError(() => g.roll("alice", 2.5), "invalid_dice");
    expectError(() => g.roll("alice"), "invalid_dice");
  });

  it("adds multiple dice together, for items later", () => {
    const g = started(ctxFor());
    g.roll("alice", 1, 1);
    expect(g.p("alice").space).toBe("s03");
  });

  it("pausing stops rolls and freezes the clocks", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    g.do({ type: "pause", now: g.now });
    g.advance(4);
    expectError(() => g.roll("bob", 1), "paused");
    g.advance(20);
    g.do({ type: "resume", now: g.now });
    expect(g.state.turn.windowOpensAt).toBe(T0 + 28 * HOUR);
    expectError(() => g.roll("bob", 1), "cooldown");
    g.advance(4);
    g.roll("bob", 1);
  });

  it("can't roll before the board starts", () => {
    const g = new Game(ctxFor());
    expectError(() => g.roll("alice", 1), "not_started");
  });
});

describe("host actions", () => {
  it("set coins and stars, grant and remove items", () => {
    const g = started(ctxFor());
    g.do({ type: "setCoins", playerId: "bob", coins: 99, now: g.now });
    g.do({ type: "setStars", playerId: "bob", stars: 2, now: g.now });
    g.do({ type: "grantItem", playerId: "bob", itemId: "mushroom", now: g.now });
    expect(g.p("bob")).toMatchObject({ coins: 99, stars: 2, items: ["mushroom"] });
    g.do({ type: "removeItem", playerId: "bob", itemId: "mushroom", now: g.now });
    expect(g.p("bob").items).toEqual([]);
    expectError(() => g.do({ type: "setCoins", playerId: "bob", coins: -1, now: g.now }), "invalid_amount");
    expectError(() => g.do({ type: "removeItem", playerId: "bob", itemId: "mushroom", now: g.now }), "unknown_item");
  });

  it("move a player and the star", () => {
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.do({ type: "movePlayer", playerId: "bob", spaceId: "s09", now: g.now });
    g.do({ type: "moveStar", spaceId: "s08", now: g.now });
    expect(g.p("bob").space).toBe("s09");
    expect(g.state.star).toBe("s08");
    expectError(() => g.do({ type: "moveStar", spaceId: "s03", now: g.now }), "invalid_star_space");
  });

  it("removing the current player hands the turn to the next one", () => {
    const g = started(ctxFor());
    const ev = g.do({ type: "removePlayer", playerId: "alice", now: g.now });
    expect(ev[0]).toMatchObject({ type: "PlayerRemoved", playerId: "alice", player: { coins: 10 } });
    expect(g.state.turn.order).toEqual(["bob", "cara"]);
    g.roll("bob", 1);
  });

  it("removing someone mid-move abandons the move", () => {
    const g = started(ctxFor());
    g.roll("alice", 4); // waiting at the shop
    g.do({ type: "removePlayer", playerId: "alice", now: g.now });
    expect(g.state.move).toBeNull();
    g.roll("bob", 1);
  });

  it("adding a player keeps their coins, stars and items", () => {
    const g = started(ctxFor());
    g.do({ type: "addPlayer", player: { id: "dan", name: "dan", coins: 42, stars: 1, items: ["mushroom"] }, now: g.now });
    expect(g.p("dan")).toMatchObject({ space: "s01", coins: 42, stars: 1, items: ["mushroom"] });
    expect(g.state.turn.order).toEqual(["alice", "bob", "cara", "dan"]);
  });

  it("new players start with the configured coins", () => {
    const g = started(ctxFor());
    g.do({ type: "addPlayer", player: { id: "dan", name: "dan" }, now: g.now });
    expect(g.p("dan").coins).toBe(10);
  });

  it("reordering keeps the current player's turn", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    g.do({ type: "setTurnOrder", order: ["cara", "bob", "alice"], now: g.now });
    expect(g.state.turn.order[g.state.turn.index]).toBe("bob");
    expectError(() => g.do({ type: "setTurnOrder", order: ["cara", "bob"], now: g.now }), "invalid_order");
  });
});

describe("undo and replay", () => {
  it("replaying the log rebuilds the exact state", () => {
    const g = started(ctxFor());
    g.roll("alice", 6);
    g.do({ type: "shopBuy", playerId: "alice", itemId: "mushroom", now: g.now });
    g.advance(4);
    g.roll("bob", 2);
    expect(replay(g.ctx, { initial: g.initial, actions: g.actions }).state).toEqual(g.state);
  });

  it("undo drops the last action", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    const before = g.state;
    g.do({ type: "setCoins", playerId: "alice", coins: 0, now: g.now });
    expect(undo(g.ctx, { initial: g.initial, actions: g.actions }).state).toEqual(before);
  });

  it("undoTurn rewinds to just before the last roll, including its choices", () => {
    const g = started(ctxFor());
    const before = g.state;
    g.roll("alice", 6);
    g.do({ type: "shopBuy", playerId: "alice", itemId: "mushroom", now: g.now });
    const { state, log } = undoTurn(g.ctx, { initial: g.initial, actions: g.actions });
    expect(state).toEqual(before);
    expect(log.actions.map((a) => a.type)).toEqual(["startBoard"]);
  });
});

describe("purity", () => {
  it("never mutates the input state, even when an action fails", () => {
    const g = started(ctxFor());
    const snapshot = structuredClone(g.state);
    try {
      g.roll("bob", 1);
    } catch {
      // expected
    }
    g.roll("alice", 6);
    expect(g.initial).not.toBe(g.state);
    expect(snapshot.players.alice.space).toBe("s01");
  });
});

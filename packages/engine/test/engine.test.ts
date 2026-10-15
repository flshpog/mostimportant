import { describe, expect, it } from "vitest";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { ADVANTAGE_ID, EngineError, eventFor, possibleEvents, stateFor, replay, shopStock, starPriceFor, undo, undoTurn, type EngineEvent } from "../src";
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

  it("event spaces only trigger on landing, not passing", () => {
    const g = started(ctxFor());
    g.setup("alice", "s05");
    g.roll("alice", 2); // passes s06, lands on the s07 fork... s07 is the landing
    expect(g.state.move).toBeNull();
    expect(g.p("alice").space).toBe("s07");
  });

  it("with every event weighted 0, an event space does nothing", () => {
    const off = { coinSteal: { weight: 0, percents: [5] }, starSteal: { weight: 0, price: 40 }, swap: { weight: 0 } };
    const g = started(ctxFor(lineLayout, { events: off }));
    g.setup("alice", "s05");
    const ev = g.roll("alice", 1);
    expect(ev).toContainEqual({ type: "EventFizzled", playerId: "alice", event: null, reason: "no_events" });
    expect(g.state.move).toBeNull();
  });
});

describe("event spaces", () => {
  // alice lands on the s06 event space and waits for the server's draw.
  function atEvent(players = ["alice", "bob", "cara"]) {
    const g = started(ctxFor(), players);
    g.setup("alice", "s05");
    g.roll("alice", 1);
    expect(g.state.move?.choice?.kind).toBe("eventDraw");
    return g;
  }
  const draw = (g: Game, event: "coinSteal" | "starSteal" | "swap", percent = 25) =>
    g.do({ type: "drawEvent", playerId: "alice", event, percent, now: g.now });
  const target = (g: Game, targetId: string | null, playerId = "alice") => g.do({ type: "eventTarget", playerId, targetId, now: g.now });

  it("only the server's draw settles the landing, and players can't draw", () => {
    const g = atEvent();
    expectError(() => target(g, "bob"), "no_pending_choice");
    // no timeout on the draw itself
    g.advance(5);
    expect(types(g.tick())).toEqual([]);
  });

  it("coin steal takes the rolled share of the target's coins, rounded down", () => {
    const g = atEvent();
    g.p("bob").coins = 0;
    g.state.players.bob.coins = 15;
    const ev = draw(g, "coinSteal", 25);
    expect(ev[0]).toEqual({ type: "EventDrawn", playerId: "alice", spaceId: "s06", event: "coinSteal", targets: ["bob", "cara"] });
    expect(g.state.move?.choice).toMatchObject({ kind: "coinSteal", percent: 25 });
    const ev2 = target(g, "bob");
    expect(ev2[0]).toEqual({ type: "CoinsStolen", playerId: "alice", targetId: "bob", percent: 25, amount: 3, auto: false });
    expect(g.p("bob").coins).toBe(12);
    expect(g.p("alice").coins).toBe(13);
    expect(g.state.move).toBeNull();
  });

  it("coin steal can't be declined, and on timeout robs the richest tribemate", () => {
    const g = atEvent();
    g.state.players.bob.coins = 4;
    g.state.players.cara.coins = 40;
    draw(g, "coinSteal", 50);
    expectError(() => target(g, null), "wrong_choice");
    expectError(() => target(g, "alice"), "wrong_choice");
    g.advance(1);
    const ev = g.tick();
    expect(ev).toContainEqual({ type: "CoinsStolen", playerId: "alice", targetId: "cara", percent: 50, amount: 20, auto: true });
    expect(g.p("alice").coins).toBe(30);
  });

  it("star steal costs coins and moves one star", () => {
    const g = atEvent();
    g.state.players.alice.coins = 45;
    g.state.players.cara.stars = 2;
    const ev = draw(g, "starSteal");
    expect(ev[0]).toMatchObject({ event: "starSteal", targets: ["cara"] });
    expectError(() => target(g, "bob"), "wrong_choice");
    target(g, "cara");
    expect(g.p("alice")).toMatchObject({ coins: 5, stars: 1 });
    expect(g.p("cara").stars).toBe(1);
  });

  it("star steal fizzles when nobody has a star or you can't pay", () => {
    let g = atEvent();
    g.state.players.alice.coins = 100;
    expect(draw(g, "starSteal")).toContainEqual({ type: "EventFizzled", playerId: "alice", event: "starSteal", reason: "no_stars" });
    expect(g.state.move).toBeNull();
    g = atEvent();
    g.state.players.bob.stars = 1;
    expect(draw(g, "starSteal")).toContainEqual({ type: "EventFizzled", playerId: "alice", event: "starSteal", reason: "too_poor", price: 40 });
    expect(g.p("alice").coins).toBe(10);
  });

  it("star steal and swap can be declined, and time out to a decline", () => {
    let g = atEvent();
    g.state.players.alice.coins = 50;
    g.state.players.bob.stars = 1;
    draw(g, "starSteal");
    expect(target(g, null)).toContainEqual({ type: "EventDeclined", playerId: "alice", event: "starSteal", auto: false });
    expect(g.p("alice").coins).toBe(50);
    g = atEvent();
    draw(g, "swap");
    g.advance(1);
    expect(g.tick()).toContainEqual({ type: "EventDeclined", playerId: "alice", event: "swap", auto: true });
    expect(g.p("alice").space).toBe("s06");
  });

  it("swap trades positions without triggering either space", () => {
    const g = atEvent();
    g.state.players.bob.space = "s02";
    draw(g, "swap");
    const ev = target(g, "bob");
    expect(ev[0]).toEqual({ type: "PlayersSwapped", playerId: "alice", targetId: "bob", playerTo: "s02", targetTo: "s06" });
    expect(types(ev)).not.toContain("CoinsChanged");
    expect(g.p("alice").space).toBe("s02");
    expect(g.p("bob").space).toBe("s06");
  });

  it("possibleEvents leaves out events that would fizzle", () => {
    const g = atEvent();
    const kinds = () => possibleEvents(g.ctx, g.state, "alice").map((x) => x.event);
    expect(kinds()).toEqual(["coinSteal", "swap"]); // nobody has a star
    g.state.players.bob.stars = 1;
    expect(kinds()).toEqual(["coinSteal", "swap"]); // alice has 10 coins, needs 40
    g.state.players.alice.coins = 40;
    expect(kinds()).toEqual(["coinSteal", "starSteal", "swap"]);
    const alone = atEvent(["alice"]);
    expect(possibleEvents(alone.ctx, alone.state, "alice")).toEqual([]);
  });

  it("alone on the board, every event fizzles", () => {
    const g = atEvent(["alice"]);
    expect(draw(g, "swap")).toContainEqual({ type: "EventFizzled", playerId: "alice", event: "swap", reason: "no_targets" });
  });

  it("pausing freezes the event timer", () => {
    const g = atEvent();
    draw(g, "swap");
    g.do({ type: "pause", now: g.now });
    g.advance(3);
    g.do({ type: "resume", now: g.now });
    g.advance(0.5);
    g.tick();
    expect(g.state.move?.choice?.kind).toBe("swap");
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

  it("open the current turn early, keeping the full window from now", () => {
    const g = started(ctxFor());
    g.roll("alice", 1); // bob's window opens in 4h
    g.advance(1);
    expectError(() => g.roll("bob", 1), "cooldown");
    const ev = g.do({ type: "openTurnNow", now: g.now });
    expect(ev).toEqual([{ type: "TurnStarted", playerId: "bob", windowOpensAt: g.now, deadline: g.now + 12 * HOUR }]);
    g.roll("bob", 1);
  });

  it("skip the current player; the next one can roll right away", () => {
    const g = started(ctxFor());
    g.roll("alice", 1);
    const ev = g.do({ type: "skipTurn", now: g.now });
    expect(ev[0]).toEqual({ type: "TurnSkipped", playerId: "bob", byHost: true });
    g.roll("cara", 1);
  });

  it("won't open or skip a turn mid-move", () => {
    const g = started(ctxFor());
    g.roll("alice", 4); // waiting at the shop
    expectError(() => g.do({ type: "openTurnNow", now: g.now }), "busy");
    expectError(() => g.do({ type: "skipTurn", now: g.now }), "busy");
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

describe("describeEvent", () => {
  it("writes a readable line for every event in a real turn", async () => {
    const { describeEvent } = await import("../src");
    const g = started(ctxFor(), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 25);
    const ev = [...g.roll("alice", 2), ...g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s08", now: g.now })];
    const lines = ev.map((e) => describeEvent(e, (id) => id.toUpperCase())).filter(Boolean);
    expect(lines).toEqual([
      "ALICE rolled a 2.",
      "ALICE reached the star! It costs 20 coins.",
      "⭐ ALICE bought a star!",
      "The star flew to a new spot.",
      "ALICE landed on a red space.",
      "ALICE lost 3 coins. Now 2.",
      "It's BOB's turn.",
    ]);
  });
});

describe("the shop and items", () => {
  const season = loadSeasonConfig();
  const shopCtx = () => ctxFor(lineLayout, { shop: season.shop });
  // alice on s04, one step before the s05 shop (which sells everything)
  function atShop(coins = 100) {
    const g = started(shopCtx());
    g.setup("alice", "s04", coins);
    return g;
  }
  const buy = (g: Game, itemId: string) => g.do({ type: "shopBuy", playerId: "alice", itemId, now: g.now });
  const use = (g: Game, itemId: string, targetId: string | null = null, playerId = "alice", nextStarSpace?: string) =>
    g.do({ type: "useItem", playerId, itemId, targetId, nextStarSpace, now: g.now });
  // makes it alice's turn again, open now, with nothing in progress
  const herTurn = (g: Game) => g.setup("alice", g.p("alice").space);
  // rolls past the shop (skipping it) onto the s07 blue space, ending the move
  const walkPast = (g: Game) => {
    g.roll("alice", 3);
    if (g.state.move?.choice?.kind === "shop") g.do({ type: "shopSkip", playerId: "alice", now: g.now });
    expect(g.state.move).toBeNull();
  };

  it("bags and purchases are private to their owner (and the hosts)", () => {
    const g = atShop();
    g.stock = ["boo-bell", "magic-lamp"];
    g.roll("alice", 1);
    const bought = buy(g, "boo-bell").find((e) => e.type === "ShopPurchase")!;
    expect(stateFor(g.state, "alice", false).players.alice.items).toEqual(["boo-bell"]);
    expect(stateFor(g.state, "bob", false).players.alice.items).toEqual([]);
    expect(stateFor(g.state, null, false).players.alice.items).toEqual([]);
    expect(stateFor(g.state, "bob", true).players.alice.items).toEqual(["boo-bell"]);
    expect(eventFor(bought, "alice", false)).toEqual(bought);
    expect(eventFor(bought, "bob", false)).toEqual({ type: "ShopPurchase", playerId: "alice", itemId: "", price: 0 });
    expect(eventFor({ type: "AdvantagePurchased", playerId: "alice", price: 40 }, null, false)).toEqual({ type: "ShopPurchase", playerId: "alice", itemId: "", price: 0 });
  });

  it("a shop offers the items drawn for this visit, and only those", () => {
    const g = atShop();
    g.stock = ["boo-bell", "magic-lamp"];
    g.roll("alice", 1);
    expect(g.state.move?.choice).toMatchObject({ kind: "shop", stock: ["boo-bell", "magic-lamp"] });
    expectError(() => buy(g, "mushroom"), "unknown_item");
    buy(g, "boo-bell");
    expect(g.p("alice").items).toEqual(["boo-bell"]);
  });

  it("a shop can't be stocked with the same item twice", () => {
    const g = started(shopCtx());
    g.setup("alice", "s04", 100);
    g.stock = ["mushroom", "mushroom"];
    expectError(() => g.roll("alice", 1), "unknown_item");
  });

  it("the bag holds three items; a full bag can't buy", () => {
    const g = atShop();
    g.p("alice").items = ["mushroom", "mushroom", "mushroom"];
    const ev = g.roll("alice", 1);
    expect(ev).toContainEqual({ type: "ShopUnaffordable", playerId: "alice", spaceId: "s05", bagFull: true });
  });

  it("the tribe advantage costs coins, skips the bag, and sells once per board", () => {
    const g = atShop(50);
    g.state.boardId = "mario-stadium";
    g.roll("alice", 1);
    expect(shopStock(g.ctx, g.state, []).advantage?.name).toBe("Launch Star");
    const ev = buy(g, ADVANTAGE_ID);
    expect(ev).toContainEqual({ type: "AdvantagePurchased", playerId: "alice", price: 40 });
    expect(g.p("alice")).toMatchObject({ coins: 10, items: [] });
    expect(g.state.advantageSold).toBe(true);
    expect(shopStock(g.ctx, g.state, []).advantage).toBeNull();
  });

  it("a Mushroom means two dice, and only one item a turn", () => {
    const g = atShop();
    g.p("alice").items = ["mushroom", "slow-mushroom"];
    use(g, "mushroom");
    expectError(() => use(g, "slow-mushroom"), "item_used");
    expectError(() => g.roll("alice", 4), "invalid_dice");
    const ev = g.roll("alice", 2, 3);
    expect(ev[0]).toMatchObject({ type: "DiceRolled", dice: [2, 3], total: 5, item: "mushroom" });
    expect(g.p("alice").items).toEqual(["slow-mushroom"]);
  });

  it("a Slow Mushroom only rolls 1-5", () => {
    const g = atShop();
    g.p("alice").items = ["slow-mushroom"];
    use(g, "slow-mushroom");
    expectError(() => g.roll("alice", 6), "invalid_dice");
    g.roll("alice", 5);
  });

  it("a Custom Dice Block rolls nothing: you choose any number; a timeout takes the highest", () => {
    let g = atShop();
    g.p("alice").items = ["reroll-block"];
    use(g, "reroll-block");
    expectError(() => g.roll("alice", 3), "invalid_dice");
    const ev = g.roll("alice");
    expect(ev[0]).toMatchObject({ type: "DiceRolled", dice: [], choose: true, item: "reroll-block" });
    expect(g.state.move?.choice).toMatchObject({ kind: "dicePick", options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], item: "reroll-block" });
    expectError(() => g.do({ type: "pickDie", playerId: "alice", value: 11, now: g.now }), "wrong_choice");
    const picked = g.do({ type: "pickDie", playerId: "alice", value: 1, now: g.now });
    expect(picked[0]).toMatchObject({ type: "DiePicked", value: 1, item: "reroll-block", auto: false });
    expect(g.p("alice").space).toBe("s05");

    g = atShop();
    g.p("alice").items = ["reroll-block"];
    use(g, "reroll-block");
    g.roll("alice");
    g.advance(1);
    expect(g.tick()).toContainEqual({ type: "DiePicked", playerId: "alice", value: 10, total: 10, auto: true, item: "reroll-block" });
  });

  it("a Poison Mushroom halves the target's next roll, once", () => {
    const g = atShop();
    g.p("alice").items = ["poison-mushroom"];
    expectError(() => use(g, "poison-mushroom"), "wrong_choice"); // needs a target
    use(g, "poison-mushroom", "bob");
    expect(g.p("bob").poisoned).toBe(true);
    walkPast(g);
    g.advance(5);
    g.setup("bob", "s01");
    const ev = g.roll("bob", 7);
    expect(ev[0]).toMatchObject({ type: "DiceRolled", total: 3, halvedFrom: 7 });
    expect(g.p("bob").poisoned).toBe(false);
  });

  it("a Boo Bell takes up to 7 coins; a Blue Shell blocks it and is used up", () => {
    const g = atShop(10);
    g.p("alice").items = ["boo-bell", "boo-bell"];
    g.p("bob").coins = 5;
    use(g, "boo-bell", "bob");
    expect(g.p("bob").coins).toBe(0);
    expect(g.p("alice").coins).toBe(15);
    walkPast(g);
    herTurn(g);
    g.p("cara").items = ["guard-charm"];
    const ev = use(g, "boo-bell", "cara");
    expect(types(ev)).toEqual(["ItemUsed", "ItemSpent", "StealBlocked"]);
    expect(g.p("cara")).toMatchObject({ coins: 10, items: [] });
  });

  it("a Blue Shell also blocks event steals, and a blocked star steal isn't paid for", () => {
    const g = started(ctxFor(lineLayout, { shop: season.shop }));
    g.setup("alice", "s05", 50);
    g.p("bob").stars = 1;
    g.p("bob").items = ["guard-charm"];
    g.roll("alice", 1);
    g.do({ type: "drawEvent", playerId: "alice", event: "starSteal", percent: 25, now: g.now });
    const ev = g.do({ type: "eventTarget", playerId: "alice", targetId: "bob", now: g.now });
    expect(ev).toContainEqual({ type: "StealBlocked", playerId: "alice", targetId: "bob", by: "starSteal" });
    expect(g.p("alice")).toMatchObject({ coins: 50, stars: 0 });
    expect(g.p("bob")).toMatchObject({ stars: 1, items: [] });
  });

  it("a Magic Lamp takes 10 off the next star and is used up", () => {
    const g = started(ctxFor(lineLayout, { shop: season.shop }), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 12);
    g.p("alice").items = ["magic-lamp"];
    expect(starPriceFor(g.ctx, g.p("alice")).price).toBe(10);
    const ev = g.roll("alice", 1);
    expect(ev).toContainEqual({ type: "StarOffered", playerId: "alice", spaceId: "s02", price: 10 });
    const ev2 = g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s08", now: g.now });
    expect(ev2).toContainEqual({ type: "StarPurchased", playerId: "alice", spaceId: "s02", price: 10, discount: 10 });
    expect(g.p("alice").items).toEqual([]);
  });

  it("a Crystal Ball fixes where the star goes next, until it's bought", () => {
    const g = started(ctxFor(lineLayout, { shop: season.shop }), ["alice", "bob"], "s02");
    g.setup("alice", "s01", 40);
    g.p("alice").items = ["star-compass", "star-compass"];
    expectError(() => use(g, "star-compass"), "invalid_star_space"); // the server must pick
    use(g, "star-compass", null, "alice", "s08");
    expect(g.state.nextStar).toBe("s08");
    g.roll("alice", 1);
    g.do({ type: "buyStar", playerId: "alice", newStarSpace: "s08", now: g.now });
    expect(g.state.star).toBe("s08");
    expect(g.state.nextStar).toBeNull();
  });

  it("held items can't be used, and only on your own turn", () => {
    const g = atShop();
    g.p("alice").items = ["guard-charm"];
    expectError(() => use(g, "guard-charm"), "wrong_choice");
    g.p("bob").items = ["mushroom"];
    expectError(() => use(g, "mushroom", null, "bob"), "not_your_turn");
    expectError(() => use(g, "boo-bell"), "unknown_item");
  });
});

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyToken, type SessionUser } from "../src";
import { ALICE, BOB, CARA, HOST, ORIGIN, SECRET, seedBoard, startHarness, T0, type Harness } from "./harness";

const HOUR = 3_600_000;
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

describe("http basics", () => {
  it("health check, CORS for the site, and a block on other origins", async () => {
    const ok = await h.api("/api/health");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const pre = await fetch(h.srv.url + "/api/me", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "GET" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    const evil = await h.api("/api/health", { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
  });

  it("needs a login token, and rejects forged ones", async () => {
    expect((await h.api("/api/me")).status).toBe(401);
    const forged = await fetch(h.srv.url + "/api/me", { headers: { origin: ORIGIN, authorization: `Bearer ${h.token(ALICE)}x` } });
    expect(forged.status).toBe(401);
  });

  it("unknown endpoints and boards are 404s with plain messages", async () => {
    expect((await h.api("/api/nope", { as: ALICE })).status).toBe(404);
    const r = await h.api("/api/boards/nope", { as: HOST });
    expect(r.status).toBe(404);
    expect(r.body.error.message).toMatch(/no board/i);
  });
});

describe("boards and visibility", () => {
  beforeEach(() => seedBoard(h));

  it("creates the four configured boards; hosts see all of them", async () => {
    const r = await h.api("/api/boards", { as: HOST });
    expect(r.body.boards.map((b: { id: string }) => b.id)).toEqual(["mario-stadium", "luigis-mansion", "warioware-inc", "waluigi-pinball"]);
  });

  it("a player sees only their own board", async () => {
    const me = await h.api("/api/me", { as: ALICE });
    expect(me.body).toMatchObject({ boardId: "mario-stadium", isHost: false });
    const mine = await h.api("/api/boards", { as: ALICE });
    expect(mine.body.boards.map((b: { id: string }) => b.id)).toEqual(["mario-stadium"]);
    expect((await h.api("/api/boards/mario-stadium", { as: ALICE })).status).toBe(200);
    const other = await h.api("/api/boards/luigis-mansion", { as: ALICE });
    expect(other.status).toBe(403);
    expect((await h.api("/api/boards/luigis-mansion/events", { as: ALICE })).status).toBe(403);
  });

  it("someone on no board sees nothing", async () => {
    const r = await h.api("/api/boards", { as: "100000000000000099" });
    expect(r.body.boards).toEqual([]);
    expect((await h.api("/api/boards/mario-stadium", { as: "100000000000000099" })).status).toBe(403);
  });

  it("state carries the star start and starting coins from config", async () => {
    const r = await h.api("/api/boards/mario-stadium", { as: ALICE });
    expect(r.body.state.star).toBe("s62");
    expect(r.body.state.players[ALICE].coins).toBe(10);
    expect(r.body.state.turn.deadline).toBeNull(); // first turn has no limit
  });
});

describe("playing", () => {
  beforeEach(() => seedBoard(h));

  it("rolls with server dice, records them, and enforces turn order", async () => {
    h.rng.queue = [2];
    const r = await h.api("/api/play/roll", { method: "POST", as: ALICE });
    expect(r.status).toBe(200);
    const types = r.body.events.map((e: { event: { type: string } }) => e.event.type);
    expect(types[0]).toBe("DiceRolled");
    expect(r.body.events[0].event.dice).toEqual([2]);
    // s01 is a fork, so the move waits for a choice
    expect(types).toContain("ForkChoiceRequired");
    const fork = await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s02" } });
    expect(fork.status).toBe(200);
    const notYou = await h.api("/api/play/roll", { method: "POST", as: CARA });
    expect(notYou.status).toBe(400);
    expect(notYou.body.error).toEqual({ code: "not_your_turn", message: "It isn't your turn yet." });
    const cooldown = await h.api("/api/play/roll", { method: "POST", as: BOB });
    expect(cooldown.body.error.code).toBe("cooldown");
    expect(cooldown.body.error.message).toMatch(/opens in 4h 0m/);
  });

  it("the history endpoint returns events in order from any point", async () => {
    h.rng.queue = [1];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s79" } });
    const all = await h.api("/api/boards/mario-stadium/events", { as: ALICE });
    const seqs = all.body.events.map((e: { seq: number }) => e.seq);
    expect(seqs).toEqual(seqs.map((_: number, i: number) => i + 1));
    const tail = await h.api("/api/boards/mario-stadium/events?since=3", { as: ALICE });
    expect(tail.body.events[0].seq).toBe(4);
    expect(tail.body.seq).toBe(all.body.seq);
  });

  it("leaderboard sorts by stars, then coins, with shared ranks for ties", async () => {
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setStars", playerId: CARA, stars: 1 } } });
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: BOB, coins: 30 } } });
    const r = await h.api("/api/boards/mario-stadium/leaderboard", { as: ALICE });
    expect(r.body.leaderboard.map((x: { name: string; rank: number }) => [x.name, x.rank])).toEqual([
      ["Cara", 1],
      ["Bob", 2],
      ["Alice", 3],
    ]);
  });

  it("buying the star uses a server-picked blue space", async () => {
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: ALICE, coins: 50 } } });
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "moveStar", spaceId: "s02" } } });
    h.rng.queue = [1];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s02" } });
    h.rng.queue = [0]; // first candidate
    const r = await h.api("/api/play/star", { method: "POST", as: ALICE, body: { buy: true } });
    const moved = r.body.events.find((e: { event: { type: string } }) => e.event.type === "StarMoved");
    const blue = (await h.api("/api/boards/mario-stadium/layout", { as: ALICE })).body.layout.spaces.filter((s: { type: string }) => s.type === "blue");
    expect(blue.map((s: { id: string }) => s.id)).toContain(moved.event.to);
  });

  it("the server spins the bowser wheel itself", async () => {
    h.season.bowser = { wheel: [{ id: "tax", label: "Bowser tax", weight: 1, coins: -4, stars: 0 }] };
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "movePlayer", playerId: ALICE, spaceId: "s20" } } });
    h.rng.queue = [1];
    const r = await h.api("/api/play/roll", { method: "POST", as: ALICE }); // s20 -> s21 bowser
    const types = r.body.events.map((e: { event: { type: string } }) => e.event.type);
    expect(types).toEqual(expect.arrayContaining(["BowserSpinRequired", "BowserSpin", "TurnEnded"]));
    const s = await h.api("/api/boards/mario-stadium", { as: ALICE });
    expect(s.body.state.players[ALICE].coins).toBe(6);
  });
});

describe("host endpoints", () => {
  beforeEach(() => seedBoard(h));

  it("are closed to players", async () => {
    expect((await h.api("/api/host/boards", { as: ALICE })).status).toBe(403);
    expect((await h.api("/api/host/boards/mario-stadium/undo", { method: "POST", as: ALICE, body: {} })).status).toBe(403);
    expect((await h.api("/api/host/transfer", { method: "POST", as: ALICE, body: { playerId: ALICE, to: "luigis-mansion" } })).status).toBe(403);
  });

  it("reject things that aren't host actions, and explain rule errors", async () => {
    const bad = await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "roll", playerId: ALICE, dice: [10] } } });
    expect(bad.status).toBe(400);
    const rule = await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "moveStar", spaceId: "s05" } } });
    expect(rule.body.error).toEqual({ code: "invalid_star_space", message: "The star can't go on s05." });
  });

  it("a player can't be on two boards at once", async () => {
    const r = await h.api("/api/host/boards/luigis-mansion/actions", { method: "POST", as: HOST, body: { action: { type: "addPlayer", player: { id: ALICE, name: "Alice" } } } });
    expect(r.body.error.code).toBe("duplicate_player");
  });

  it("transfer keeps coins, stars and items; reset wipes them", async () => {
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: BOB, coins: 33 } } });
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setStars", playerId: BOB, stars: 2 } } });
    const t = await h.api("/api/host/transfer", { method: "POST", as: HOST, body: { playerId: BOB, to: "luigis-mansion" } });
    expect(t.body).toMatchObject({ from: "mario-stadium", to: "luigis-mansion", player: { coins: 33, stars: 2, space: "s01" } });
    expect((await h.api("/api/me", { as: BOB })).body.boardId).toBe("luigis-mansion");
    const r = await h.api("/api/host/transfer", { method: "POST", as: HOST, body: { playerId: BOB, to: "warioware-inc", reset: true } });
    expect(r.body.player).toMatchObject({ coins: 0, stars: 0, items: [] });
  });

  it("transfer adds someone who isn't on any board yet (the exiled player)", async () => {
    const r = await h.api("/api/host/transfer", { method: "POST", as: HOST, body: { playerId: "100000000000000017", to: "mario-stadium", name: "Exile" } });
    expect(r.body).toMatchObject({ from: null, to: "mario-stadium", player: { coins: 10 } });
  });

  it("undo rewinds a whole turn", async () => {
    const before = (await h.api("/api/boards/mario-stadium", { as: HOST })).body.state;
    h.rng.queue = [3];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s79" } });
    const r = await h.api("/api/host/boards/mario-stadium/undo", { method: "POST", as: HOST, body: { turn: true } });
    expect(r.status).toBe(200);
    expect(r.body.state).toEqual(before);
    // and the turn can be played again
    expect((await h.api("/api/play/roll", { method: "POST", as: ALICE })).status).toBe(200);
  });

  it("undo counts back through earlier undos correctly", async () => {
    const act = (coins: number) => h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: ALICE, coins } } });
    await act(1);
    await act(2);
    await act(3);
    await h.api("/api/host/boards/mario-stadium/undo", { method: "POST", as: HOST, body: {} }); // back to 2
    const r = await h.api("/api/host/boards/mario-stadium/undo", { method: "POST", as: HOST, body: { count: 1 } }); // back to 1
    expect(r.body.state.players[ALICE].coins).toBe(1);
  });
});

describe("websockets", () => {
  beforeEach(() => seedBoard(h));

  it("two connected clients see identical, gap-free event streams", async () => {
    const a = await h.ws(ALICE);
    const b = await h.ws(HOST);
    a.send({ op: "subscribe", board: "mario-stadium" });
    b.send({ op: "subscribe", board: "mario-stadium" });
    const [snapA, snapB] = await Promise.all([a.next((m) => m.op === "snapshot"), b.next((m) => m.op === "snapshot")]);
    expect(snapA.seq).toBe(snapB.seq);

    h.rng.queue = [5];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s02" } });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s15" } });
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: CARA, coins: 7 } } });
    const finalSeq = (await h.api("/api/boards/mario-stadium", { as: HOST })).body.seq;
    await Promise.all([a, b].map((c) => c.next((m) => m.op === "events" && m.events.at(-1).seq === finalSeq)));

    const ea = a.events("mario-stadium");
    expect(ea).toEqual(b.events("mario-stadium"));
    expect(ea.map((e: { seq: number }) => e.seq)).toEqual(ea.map((_: unknown, i: number) => snapA.seq + 1 + i));
    a.close();
    b.close();
  });

  it("a reconnecting client catches up from its last sequence number", async () => {
    h.rng.queue = [1];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    const c = await h.ws(ALICE);
    c.send({ op: "subscribe", board: "mario-stadium", since: 2 });
    const msg = await c.next((m) => m.op === "events");
    const all = (await h.api("/api/boards/mario-stadium/events", { as: ALICE })).body.events;
    expect(msg.events).toEqual(all.slice(2));
    c.close();
  });

  it("players can't subscribe to other boards", async () => {
    const c = await h.ws(ALICE);
    c.send({ op: "subscribe", board: "luigis-mansion" });
    expect(await c.next((m) => m.op === "error")).toMatchObject({ code: "not_your_board" });
    c.close();
  });

  it("an undo pushes a reset to everyone watching", async () => {
    const c = await h.ws(ALICE);
    c.send({ op: "subscribe", board: "mario-stadium" });
    await c.next((m) => m.op === "snapshot");
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: ALICE, coins: 99 } } });
    await h.api("/api/host/boards/mario-stadium/undo", { method: "POST", as: HOST, body: {} });
    const reset = await c.next((m) => m.op === "reset");
    expect(reset.state.players[ALICE].coins).toBe(10);
    c.close();
  });

  it("a player moved to another board stops receiving the old board", async () => {
    const c = await h.ws(BOB);
    c.send({ op: "subscribe", board: "mario-stadium" });
    await c.next((m) => m.op === "snapshot");
    await h.api("/api/host/transfer", { method: "POST", as: HOST, body: { playerId: BOB, to: "luigis-mansion" } });
    expect(await c.next((m) => m.op === "error")).toMatchObject({ code: "not_your_board" });
    c.close();
  });

  it("refuses connections from other sites", async () => {
    const { default: WebSocket } = await import("ws");
    const s = new WebSocket(h.srv.url.replace("http", "ws") + "/ws", { origin: "https://evil.example" });
    const err = await new Promise<Error>((resolve) => s.once("error", resolve));
    expect(err.message).toMatch(/403/);
  });
});

describe("persistence", () => {
  beforeEach(() => seedBoard(h));

  it("state and event numbering survive a restart", async () => {
    h.rng.queue = [4];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    const before = (await h.api("/api/boards/mario-stadium", { as: HOST })).body;
    await h.restart();
    const after = (await h.api("/api/boards/mario-stadium", { as: HOST })).body;
    expect(after.state).toEqual(before.state);
    expect(after.seq).toBe(before.seq);
    // a pending fork choice survives too, and play continues with the next seq
    const r = await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s02" } });
    expect(r.body.events[0].seq).toBe(before.seq + 1);
  });

  it("recovers when the snapshot is one write behind the log", async () => {
    const dir = join(h.dataDir, "mario-stadium");
    const staleSnapshot = readFileSync(join(dir, "state.json"), "utf8");
    await h.api("/api/host/boards/mario-stadium/actions", { method: "POST", as: HOST, body: { action: { type: "setCoins", playerId: ALICE, coins: 77 } } });
    await h.srv.close();
    writeFileSync(join(dir, "state.json"), staleSnapshot); // simulate a crash before the snapshot write
    await h.restart();
    expect((await h.api("/api/boards/mario-stadium", { as: HOST })).body.state.players[ALICE].coins).toBe(77);
  });

  it("drops a torn, half-written last line instead of failing to start", async () => {
    await h.srv.close();
    appendFileSync(join(h.dataDir, "mario-stadium", "events.jsonl"), '{"seq":999,"at":1,"ent');
    await h.restart();
    const r = await h.api("/api/boards/mario-stadium/events", { as: HOST });
    expect(r.body.events.at(-1).seq).toBe(r.body.seq);
    expect(r.body.seq).toBeLessThan(999);
  });
});

describe("timers", () => {
  it("expires a missed turn window on its own", async () => {
    await seedBoard(h);
    h.rng.queue = [1];
    await h.api("/api/play/roll", { method: "POST", as: ALICE });
    await h.api("/api/play/fork", { method: "POST", as: ALICE, body: { next: "s79" } });
    h.clock.now = T0 + 16 * HOUR + 1; // bob's whole window has passed
    const events = await h.srv.service.tick("mario-stadium");
    expect(events.map((e) => e.event.type)).toEqual(["TurnSkipped", "TurnStarted"]);
  });
});

describe("timers on the real clock", () => {
  let real: Harness;
  beforeEach(async () => {
    await h.close();
    real = await startHarness({}, { realClock: true });
    h = real;
    real.season.turns = { ...real.season.turns, choiceTimeoutMinutes: 0.002 }; // 120ms
    await seedBoard(real);
  });

  it("takes the default at a fork when the prompt times out, without anyone asking", async () => {
    const c = await real.ws(ALICE);
    c.send({ op: "subscribe", board: "mario-stadium" });
    await c.next((m) => m.op === "snapshot");
    real.rng.queue = [1];
    await real.api("/api/play/roll", { method: "POST", as: ALICE }); // pauses at the s01 fork
    const msg = await c.next((m) => m.op === "events" && m.events.some((e: { event: { type: string } }) => e.event.type === "ForkChosen"), 3000);
    expect(msg.events.find((e: { event: { type: string } }) => e.event.type === "ForkChosen").event).toMatchObject({ next: "s02", auto: true });
    c.close();
  });
});

describe("discord login", () => {
  it("login redirects to discord, and the callback hands the site a signed token", async () => {
    const login = await h.api("/auth/login");
    expect(login.status).toBe(302);
    const location = new URL(login.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("scope")).toBe("identify");
    const state = location.searchParams.get("state")!;

    // Swap in a fake Discord for the code exchange.
    await h.srv.close();
    const { startBoardServer } = await import("../src");
    const { loadLayouts } = await import("@everest/board-data");
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }));
      return new Response(JSON.stringify({ id: ALICE, username: "alice", global_name: "Alice A", avatar: "abc" }));
    }) as typeof fetch;
    h.srv = await startBoardServer({
      config: { enabled: true, port: 0, public_url: "http://localhost:8787", site_url: `${ORIGIN}/board/`, allowed_origins: [ORIGIN], guild_id: "1414321682025545822", host_role_id: "1414321682415357962", host_user_ids: [], data_dir: h.dataDir, session_days: 30 },
      dataDir: h.dataDir,
      layouts: loadLayouts(),
      loadConfig: () => h.season,
      sessionSecret: SECRET,
      oauth: { clientId: "123", clientSecret: "shh", redirectUri: "http://localhost:8787/auth/callback" },
      isHost: async () => false,
      clock: () => T0,
      fetch: fakeFetch,
      log: () => undefined,
    });

    const cb = await h.api(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    const back = cb.headers.get("location")!;
    expect(back.startsWith(`${ORIGIN}/board/#/auth?token=`)).toBe(true);
    const token = decodeURIComponent(back.split("token=")[1]);
    const user = verifyToken<SessionUser>(SECRET, token, T0);
    expect(user).toMatchObject({ sub: ALICE, name: "Alice A", avatar: `https://cdn.discordapp.com/avatars/${ALICE}/abc.png?size=128` });

    const bad = await h.api(`/auth/callback?code=abc&state=forged`);
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/board/#/auth?error=login_failed`);
  });
});

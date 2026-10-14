import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadLayouts, loadSeasonConfig, type SeasonConfig } from "@everest/board-data";
import { signToken, startBoardServer, type RunningBoardServer, type ServerConfig } from "../src";
import type { RandomSource } from "../src/random";

export const SECRET = "test-session-secret";
export const ORIGIN = "http://localhost:5173";
export const HOST = "900000000000000001";
export const ALICE = "100000000000000001";
export const BOB = "100000000000000002";
export const CARA = "100000000000000003";
export const T0 = Date.UTC(2026, 10, 1, 17);

// Dice/picks come from this list in order; when it runs out, the minimum is used.
export class ScriptedRandom implements RandomSource {
  queue: number[] = [];
  int(min: number, max: number) {
    const next = this.queue.shift();
    return next === undefined ? min : Math.min(max, Math.max(min, next));
  }
}

export interface Harness {
  srv: RunningBoardServer;
  dataDir: string;
  rng: ScriptedRandom;
  clock: { now: number };
  season: SeasonConfig;
  token(userId: string, name?: string): string;
  api(path: string, opts?: { method?: string; as?: string; body?: unknown; origin?: string }): Promise<{ status: number; body: any; headers: Headers }>;
  ws(as: string): Promise<WsClient>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export class WsClient {
  messages: any[] = [];
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const msg = JSON.parse(String(data));
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    });
  }
  send(msg: unknown) {
    this.socket.send(JSON.stringify(msg));
  }
  // Resolves with the first message matching `pred`, including ones that already
  // arrived (a reply can land while the test is still awaiting an HTTP call).
  next(pred: (m: any) => boolean = () => true, timeoutMs = 2000): Promise<any> {
    const seen = this.messages.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for websocket message")), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  // Every event seen on a board, flattened, in arrival order.
  events(board: string) {
    return this.messages.filter((m) => m.op === "events" && m.board === board).flatMap((m) => m.events);
  }
  close() {
    this.socket.close();
  }
}

export async function startHarness(seasonOverrides: Partial<SeasonConfig> = {}, opts: { realClock?: boolean } = {}): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), "everest-board-"));
  const rng = new ScriptedRandom();
  const clock = { now: T0 };
  const season: SeasonConfig = { ...loadSeasonConfig(), ...seasonOverrides };
  const config: ServerConfig = {
    enabled: true,
    port: 0,
    public_url: "http://localhost:8787",
    site_url: `${ORIGIN}/board/`,
    allowed_origins: [ORIGIN],
    guild_id: "1414321682025545822",
    host_role_id: "1414321682415357962",
    host_user_ids: [],
    data_dir: dataDir,
    session_days: 30,
  };
  const start = () =>
    startBoardServer({
      config,
      dataDir,
      layouts: loadLayouts(),
      loadConfig: () => season,
      sessionSecret: SECRET,
      oauth: { clientId: "123", clientSecret: "shh", redirectUri: "http://localhost:8787/auth/callback" },
      isHost: async (id) => id === HOST,
      random: rng,
      clock: opts.realClock ? Date.now : () => clock.now,
      log: () => undefined,
    });

  const h: Harness = {
    srv: await start(),
    dataDir,
    rng,
    clock,
    season,
    token: (userId, name = userId) => signToken(SECRET, { sub: userId, name, avatar: null, exp: T0 + 365 * 86_400_000 }),
    async api(path, { method = "GET", as, body, origin = ORIGIN } = {}) {
      const headers: Record<string, string> = { origin };
      if (as) headers.authorization = `Bearer ${h.token(as)}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await fetch(h.srv.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    },
    async ws(as) {
      const socket = new WebSocket(h.srv.url.replace("http", "ws") + "/ws", { origin: ORIGIN });
      await new Promise((resolve, reject) => (socket.once("open", resolve), socket.once("error", reject)));
      const c = new WsClient(socket);
      c.send({ op: "hello", token: h.token(as) });
      await c.next((m) => m.op === "hello");
      return c;
    },
    async restart() {
      await h.srv.close();
      h.srv = await start();
    },
    async close() {
      await h.srv.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return h;
}

// Puts alice, bob and cara on mario-stadium and starts it.
export async function seedBoard(h: Harness, board = "mario-stadium") {
  for (const [id, name] of [
    [ALICE, "Alice"],
    [BOB, "Bob"],
    [CARA, "Cara"],
  ]) {
    const r = await h.api(`/api/host/boards/${board}/actions`, { method: "POST", as: HOST, body: { action: { type: "addPlayer", player: { id, name } } } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
  await h.api(`/api/host/boards/${board}/actions`, { method: "POST", as: HOST, body: { action: { type: "startBoard" } } });
}

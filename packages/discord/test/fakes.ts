import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLayouts, loadSeasonConfig, type SeasonConfig } from "@everest/board-data";
import { BoardService } from "@everest/server";
import { BoardDiscord, type BoardChannel } from "../src";

export const PEACH = "100000000000000001";
export const TOAD = "100000000000000002";
export const HOST = "900000000000000001";
export const T0 = Date.UTC(2026, 10, 2, 17);

// A Discord message as far as the bridge cares: content, buttons, edits.
export class FakeMessage {
  deleted = false;
  history: string[] = [];
  constructor(
    readonly id: string,
    public content: string,
    public components: any[],
    public files: any[],
  ) {
    this.history.push(content);
  }
  async edit(opts: any) {
    if (typeof opts === "string") opts = { content: opts };
    if (opts.content !== undefined) {
      this.content = opts.content;
      this.history.push(opts.content);
    }
    if (opts.components !== undefined) this.components = opts.components;
    if (opts.files !== undefined) this.files = opts.files;
    return this;
  }
  async delete() {
    this.deleted = true;
  }
  // Button labels, flattened.
  get buttons(): { id: string; label: string }[] {
    return this.components.flatMap((row: any) => row.toJSON().components.map((b: any) => ({ id: b.custom_id, label: b.label })));
  }
}

let channelSeq = 0;
// Every fake channel and thread, by id, so the bridge can look threads up again.
export const channels = new Map<string, FakeChannel>();

export class FakeChannel implements BoardChannel {
  sent: FakeMessage[] = [];
  threadsCreated: FakeChannel[] = [];
  archived = false;
  private n = 0;
  constructor(
    readonly id: string = `c${++channelSeq}`,
    readonly name = "",
  ) {
    channels.set(this.id, this);
  }
  threads = {
    create: async (opts: { name: string }) => {
      const t = new FakeChannel(`t${++channelSeq}`, opts.name);
      this.threadsCreated.push(t);
      return t;
    },
  };
  async setArchived(v: boolean) {
    this.archived = v;
  }
  async send(opts: any) {
    if (typeof opts === "string") opts = { content: opts };
    const m = new FakeMessage(`m${++this.n}`, opts.content ?? "", opts.components ?? [], opts.files ?? []);
    this.sent.push(m);
    return m as any;
  }
  messages = {
    fetch: async (id: string) => {
      const m = this.sent.find((x) => x.id === id && !x.deleted);
      if (!m) throw new Error("Unknown Message");
      return m as any;
    },
  };
  live() {
    return this.sent.filter((m) => !m.deleted);
  }
  texts() {
    return this.live().map((m) => m.content);
  }
}

// Just enough of a discord.js interaction for the bridge.
export type Call = { type: string; payload: any };

export function fakeInteraction(userId: string, extra: Record<string, unknown> = {}): any & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (type: string) => async (payload?: any) => {
    calls.push({ type, payload });
  };
  return {
    calls,
    user: { id: userId, tag: `user-${userId}`, username: `user-${userId}`, globalName: null },
    channelId: "elsewhere",
    reply: record("reply"),
    deferReply: record("deferReply"),
    editReply: record("editReply"),
    deleteReply: record("deleteReply"),
    deferUpdate: record("deferUpdate"),
    followUp: record("followUp"),
    ...extra,
  } as any;
}

export interface Rig {
  service: BoardService;
  discord: BoardDiscord;
  channel: FakeChannel;
  season: SeasonConfig;
  clock: { now: number };
  dice: number[];
  dataDir: string;
  close(): void;
}

export async function rig(opts: { realClock?: boolean; season?: Partial<SeasonConfig>; thread?: boolean } = {}): Promise<Rig> {
  const dataDir = mkdtempSync(join(tmpdir(), "board-discord-"));
  const season: SeasonConfig = { ...loadSeasonConfig(), turns: { cooldownHours: 4, windowHours: 12, firstTurnUnlimited: true, choiceTimeoutMinutes: 60 }, ...opts.season };
  const clock = { now: T0 };
  const dice: number[] = [];
  const now = opts.realClock ? Date.now : () => clock.now;
  const service = new BoardService({
    dataDir,
    layouts: loadLayouts(),
    loadConfig: () => season,
    random: { int: (min, max) => Math.min(max, Math.max(min, dice.shift() ?? min)) },
    clock: now,
    log: () => undefined,
  });
  service.init();
  const channel = new FakeChannel(season.boards[0].channelId);
  const client = { users: { fetch: async () => Promise.reject(new Error("offline")) } } as any;
  const discord = new BoardDiscord({
    client,
    service,
    loadConfig: () => season,
    dataDir,
    isHost: async (id) => id === HOST,
    clock: now,
    diceFrameMs: 0,
    imageDebounceMs: 0,
    // Only Mario Stadium's channel (and threads made in it) exist in these tests.
    getChannel: async (id) => (id === channel.id || channel.threadsCreated.some((t) => t.id === id) ? channels.get(id)! : null),
    updatesThread: { enabled: !!opts.thread, name: "🎲 {board} updates" },
    log: () => undefined,
  });
  await discord.start();
  return {
    service,
    discord,
    channel,
    season,
    clock,
    dice,
    dataDir,
    close() {
      discord.stop();
      service.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const settle = async (r: Rig) => {
  // let queued sends and the debounced image (0ms) run
  for (let i = 0; i < 5; i++) {
    await new Promise((res) => setTimeout(res, 5));
    await r.discord.idle("mario-stadium");
  }
};

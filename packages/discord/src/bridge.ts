import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import { loadImage, type Image } from "@napi-rs/canvas";
import type { SeasonConfig } from "@everest/board-data";
import { currentPlayerId, describeEvent, EngineError, EVENT_NAMES, eventFor, itemDef, shopStock, usableItems, type BoardState, type EngineEvent } from "@everest/engine";
import { ServiceError, type ActionMeta, type BoardService, type HostActionInput, type StoredEvent, type WireEvent } from "@everest/server";
import { bold, buttonId, direction, narrate, parseButtonId, promptKey, promptMessage, rollButton, ts, turnMessage } from "./messages";
import { prepareBackdrops, renderBoard, renderForkCloseup, renderSpotCloseup } from "./render";

// What the bot needs to send. Text channels, threads and test fakes all fit.
export interface BoardChannel {
  id: string;
  send(options: MessageCreateOptions | string): Promise<Message>;
  messages: { fetch(id: string): Promise<Message> };
  // Text channels can start threads; threads can be archived.
  threads?: { create(options: { name: string; autoArchiveDuration?: number; reason?: string }): Promise<BoardChannel> };
  archived?: boolean | null;
  setArchived?(archived: boolean): Promise<unknown>;
}

export interface BoardDiscordOptions {
  client: Client;
  service: BoardService;
  loadConfig: () => SeasonConfig;
  dataDir: string;
  isHost: (userId: string) => Promise<boolean>;
  // Post everything except the board image in a per-board thread, so the main
  // channel stays clean. `{board}` in the name becomes the board's name.
  updatesThread?: { enabled: boolean; name: string };
  // The host role. Slash commands carry the user's roles, so /board checks them
  // directly before falling back to isHost.
  hostRoleId?: string;
  logToHost?: (text: string) => Promise<unknown>;
  // Where the hosts get pinged when someone buys a tribe advantage (they hand it out).
  hostPingChannelId?: string;
  // Folder with the tribe advantage images (shared with the website).
  advantageDir?: string;
  clock?: () => number;
  // Overridable so tests run fast.
  diceFrameMs?: number;
  imageDebounceMs?: number;
  // Pacing, so a move reads as it happens instead of arriving in one burst: the gap
  // between narration lines, and the pause before the next prompt or turn message.
  lineGapMs?: number;
  beatMs?: number;
  // A turn that opens sooner than this gets no "you're up next" message; the
  // "your turn" ping follows almost at once anyway.
  upNextMinMs?: number;
  // Defaults to fetching the board's channel from the client.
  getChannel?: (channelId: string) => Promise<BoardChannel | null>;
  log?: (message: string, error?: unknown) => void;
}

interface SavedBoard {
  imageMessageId?: string;
  imageMessageUrl?: string;
  threadId?: string;
  prompt?: { messageId: string; key: string };
  turnMessageId?: string;
  pingedWindow?: number;
}

const MAX_TIMER_MS = 2 ** 31 - 1;
const NO_MENTIONS = { parse: [] as never[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVENT_SCENES = new Set(["EventDrawn", "CoinsStolen", "StarStolen", "PlayersSwapped"]);

// Turns board events into Discord messages and Discord clicks into board actions.
// Every message comes from engine events, whatever caused them (Discord, the
// website, a timer, a host), so the channel always matches the game.
export class BoardDiscord {
  private saved: Record<string, SavedBoard> = {};
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly imageTimers = new Map<string, NodeJS.Timeout>();
  private readonly pingTimers = new Map<string, NodeJS.Timeout>();
  private readonly avatars = new Map<string, { url: string; img: Image | null }>();
  private readonly file: string;
  private readonly clock: () => number;
  private readonly log: (message: string, error?: unknown) => void;
  private stopped = false;

  constructor(private readonly opts: BoardDiscordOptions) {
    this.file = join(opts.dataDir, "discord.json");
    this.clock = opts.clock ?? Date.now;
    this.log = opts.log ?? ((m, e) => (e ? console.error(m, e) : console.log(m)));
  }

  async start() {
    await prepareBackdrops([...new Set(this.opts.service.boardIds().map((id) => this.opts.service.summary(id).layoutId))]).catch((e) =>
      this.log("[board] couldn't load the Discord board backdrop; using the flat drawing", e),
    );
    if (existsSync(this.file)) {
      try {
        this.saved = JSON.parse(readFileSync(this.file, "utf8"));
      } catch (e) {
        this.log("[board] discord.json unreadable, starting fresh", e);
      }
    }
    this.opts.service.on("events", this.onEvents);
    this.opts.service.on("reset", this.onReset);
    // Bring every channel up to date after a restart.
    await Promise.all(
      this.opts.service.boardIds().map((id) =>
        this.enqueue(id, async () => {
          const ch = await this.feed(id);
          if (!ch) return;
          const { state } = this.opts.service.state(id);
          await this.syncPrompt(id, ch, state);
          this.schedulePing(id, state);
          await this.refreshImage(id);
        }),
      ),
    );
  }

  stop() {
    this.stopped = true;
    this.opts.service.off("events", this.onEvents);
    this.opts.service.off("reset", this.onReset);
    for (const t of [...this.imageTimers.values(), ...this.pingTimers.values()]) clearTimeout(t);
  }

  // Resolves once everything queued for a board has been sent. For tests and /board.
  idle(boardId: string): Promise<unknown> {
    return this.queues.get(boardId) ?? Promise.resolve();
  }

  // ---- plumbing ----

  private persist() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.saved, null, 2));
    renameSync(tmp, this.file);
  }

  private board(id: string): SavedBoard {
    return (this.saved[id] ??= {});
  }

  // One queue per board keeps its messages in order (dice, then narration, then prompt).
  private enqueue(boardId: string, fn: () => Promise<unknown>): Promise<unknown> {
    const next = (this.queues.get(boardId) ?? Promise.resolve()).then(fn).catch((e) => this.log(`[board] discord update for ${boardId} failed`, e));
    this.queues.set(boardId, next);
    return next;
  }

  private async fetchChannel(id: string): Promise<BoardChannel | null> {
    if (this.opts.getChannel) return this.opts.getChannel(id);
    const ch = await this.opts.client.channels.fetch(id).catch(() => null);
    return ch && ch.isTextBased() && "send" in ch ? (ch as unknown as BoardChannel) : null;
  }

  // The board's own channel, where the board image lives.
  private channel(boardId: string): Promise<BoardChannel | null> {
    return this.fetchChannel(this.opts.service.summary(boardId).channelId);
  }

  // Where everything else goes: the board's updates thread (created on first use,
  // reopened if Discord archived it), or the channel itself with threads off.
  private async feed(boardId: string): Promise<BoardChannel | null> {
    const parent = await this.channel(boardId);
    const thread = this.opts.updatesThread;
    if (!parent || !thread?.enabled || !parent.threads) return parent;
    const saved = this.board(boardId);
    if (saved.threadId) {
      const existing = await this.fetchChannel(saved.threadId);
      if (existing) {
        if (existing.archived && existing.setArchived) await existing.setArchived(false).catch(() => undefined);
        return existing;
      }
    }
    const name = thread.name.replace("{board}", this.opts.service.summary(boardId).name).slice(0, 100);
    const created = await parent.threads.create({ name, autoArchiveDuration: 10080, reason: "Season 3 board updates" });
    saved.threadId = created.id;
    this.persist();
    return created;
  }

  private async fetchMessage(ch: BoardChannel, id: string | undefined): Promise<Message | null> {
    return id ? ch.messages.fetch(id).catch(() => null) : null;
  }

  private names(state: BoardState) {
    return (id: string) => state.players[id]?.name ?? "someone";
  }

  private itemName = (id: string) => this.opts.loadConfig().shop.items.find((i) => i.id === id)?.name ?? id;

  // Plain-language error for a player or host; anything unexpected gets logged.
  private friendly(e: unknown): string {
    if (e instanceof EngineError || e instanceof ServiceError) return e.message;
    this.log("[board] unexpected error", e);
    return "Something went wrong. Try again in a moment, or ask a host.";
  }

  // ---- reacting to the game ----

  private onEvents = (boardId: string, stored: StoredEvent[], state: BoardState, meta: ActionMeta) => {
    if (this.stopped) return;
    void this.enqueue(boardId, () => this.handleBatch(boardId, stored.map((s) => s.event), state, meta));
  };

  private onReset = (boardId: string, state: BoardState) => {
    if (this.stopped) return;
    void this.enqueue(boardId, async () => {
      const ch = await this.feed(boardId);
      if (!ch) return;
      await ch.send({ content: "The hosts rewound the board.", allowedMentions: NO_MENTIONS });
      await this.syncPrompt(boardId, ch, state);
      await this.announceTurn(boardId, ch, state);
      this.schedulePing(boardId, state);
      this.scheduleImage(boardId);
    });
  };

  private async handleBatch(boardId: string, events: WireEvent[], state: BoardState, meta: ActionMeta) {
    const ch = await this.feed(boardId);
    if (!ch) return;
    // Player moves and timeouts are narrated; host edits are silent (the image and
    // prompts still update).
    let spoke = false;
    if (!meta.host) {
      // the channel is public: nobody's purchases or bag changes are named there
      const lines = narrate(events.map((e) => eventFor(e, null, false)), this.names(state), this.itemName);
      const roll = events.find((e): e is Extract<EngineEvent, { type: "DiceRolled" }> => e.type === "DiceRolled");
      const scene = events.find((e) => EVENT_SCENES.has(e.type)) as EngineEvent | undefined;
      if (roll) {
        await this.retireTurnMessage(ch, boardId);
        await this.diceAnimation(ch, roll, state, lines);
        spoke = true;
      } else if (scene) {
        await this.eventScene(ch, scene, state);
        if (lines.length) {
          await sleep(this.opts.lineGapMs ?? 1300);
          await this.reveal(ch, [], lines);
        }
        spoke = true;
      } else if (lines.length) {
        await this.reveal(ch, [], lines);
        spoke = true;
      }
    }
    for (const e of events) if (e.type === "AdvantagePurchased") await this.pingHostsAdvantage(boardId, e.playerId, e.price, state);
    const turnChanged = events.some((e) => e.type === "TurnStarted" || e.type === "BoardStarted");
    // let the move sink in before asking for the next thing
    if (spoke && (promptKey(state) !== (this.board(boardId).prompt?.key ?? null) || turnChanged)) await sleep(this.opts.beatMs ?? 1500);
    await this.syncPrompt(boardId, ch, state);
    if (turnChanged) await this.announceTurn(boardId, ch, state);
    this.schedulePing(boardId, state);
    this.scheduleImage(boardId);
  }

  // A few quick edits that land on the result the server already rolled.
  private async diceAnimation(ch: BoardChannel, roll: Extract<EngineEvent, { type: "DiceRolled" }>, state: BoardState, lines: string[]) {
    const who = bold(this.names(state)(roll.playerId));
    // a Custom Dice Block doesn't roll: the player chooses next
    if (roll.choose) {
      await this.reveal(ch, [], lines);
      return;
    }
    const frame = this.opts.diceFrameMs ?? 450;
    const { min, max } = this.opts.loadConfig().dice;
    const face = () => min + Math.floor(Math.random() * (max - min + 1)); // cosmetic only
    const msg = await ch.send({ content: `🎲 ${who} is rolling...`, allowedMentions: NO_MENTIONS });
    for (let i = 0; i < 2; i++) {
      await sleep(frame);
      await msg.edit({ content: `🎲 ${who} is rolling... ${bold(String(face()))}` });
    }
    await sleep(frame);
    const raw = roll.halvedFrom ?? roll.total;
    let result = roll.choose
      ? `rolled a ${bold(String(roll.dice[0]))} and a ${bold(String(roll.dice[1]))}.`
      : roll.dice.length > 1
        ? `rolled ${roll.dice.join(" + ")} = ${bold(String(raw))}.`
        : `rolled a ${bold(String(raw))}.`;
    if (roll.halvedFrom !== undefined) result = result.replace(/\.$/, `, halved to ${bold(String(roll.total))} by poison.`);
    await msg.edit({ content: `🎲 ${who} ${result}` });
    await this.reveal(ch, [`🎲 ${who} ${result}`], lines, msg);
  }

  // Event spaces play out over a few edits instead of one line: the event "spins"
  // before it's revealed, the steal wheel ticks through its percentages, and steals
  // and swaps happen in two beats. Every outcome was already decided by the server.
  private async eventScene(ch: BoardChannel, e: EngineEvent, state: BoardState) {
    const name = (id: string) => bold(this.names(state)(id));
    const frame = this.opts.diceFrameMs ?? 450;
    const gap = this.opts.lineGapMs ?? 1300;
    const spin = async (msg: Message, prefix: string, faces: string[], result: string) => {
      // slows down as it goes, like a wheel
      const order = [...faces, ...faces].slice(0, 6);
      for (let i = 0; i < order.length; i++) {
        await sleep(frame * (0.5 + i * 0.18));
        await msg.edit({ content: `${prefix} ${order[i]}` });
      }
      await sleep(frame);
      await msg.edit({ content: `${prefix} ${result}` });
    };
    if (e.type === "EventDrawn") {
      const prefix = `${name(e.playerId)} landed on an event space.`;
      const msg = await ch.send({ content: `${prefix} ...`, allowedMentions: NO_MENTIONS });
      const faces = Object.values(EVENT_NAMES).map((n) => `${n}...`);
      await spin(msg, prefix, faces, `It's ${bold(EVENT_NAMES[e.event])}.`);
    } else if (e.type === "CoinsStolen") {
      const lead = e.auto
        ? `${name(e.playerId)} ran out of time, so they steal from ${name(e.targetId)}, who has the most coins.`
        : `${name(e.playerId)} is stealing from ${name(e.targetId)}.`;
      const prefix = `${lead}\nThe wheel spins...`;
      const msg = await ch.send({ content: prefix, allowedMentions: NO_MENTIONS });
      const faces = this.opts.loadConfig().events.coinSteal.percents.map((p) => bold(`${p}%`));
      await spin(msg, prefix, faces, `and lands on ${bold(`${e.percent}%`)}.`);
      await sleep(gap);
      await msg.edit({ content: `${prefix} and lands on ${bold(`${e.percent}%`)}.\n${name(e.playerId)} takes ${bold(`${e.amount} coin${e.amount === 1 ? "" : "s"}`)} from ${name(e.targetId)}.` });
    } else if (e.type === "StarStolen") {
      const first = `${name(e.playerId)} pays ${bold(`${e.price} coins`)}...`;
      const msg = await ch.send({ content: first, allowedMentions: NO_MENTIONS });
      await sleep(gap);
      await msg.edit({ content: `${first}\nand takes a star from ${name(e.targetId)}.` });
    } else if (e.type === "PlayersSwapped") {
      const first = `${name(e.playerId)} picked ${name(e.targetId)}...`;
      const msg = await ch.send({ content: first, allowedMentions: NO_MENTIONS });
      await sleep(gap);
      await msg.edit({ content: `${first}\nand they swap places.` });
    }
  }

  // Adds narration lines one at a time to a single message (editing `msg`, or a new
  // one), so a move unfolds instead of arriving as one block.
  private async reveal(ch: BoardChannel, shown: string[], lines: string[], msg?: Message) {
    const gap = this.opts.lineGapMs ?? 1300;
    const out = [...shown];
    for (const line of lines) {
      out.push(line);
      if (msg) {
        await sleep(gap);
        await msg.edit({ content: out.join("\n") });
      } else {
        msg = await ch.send({ content: line, allowedMentions: NO_MENTIONS });
      }
    }
  }

  // Keeps exactly one live prompt per board: retire the old one's buttons, post the new.
  private async syncPrompt(boardId: string, ch: BoardChannel, state: BoardState) {
    const saved = this.board(boardId);
    const key = promptKey(state);
    if (saved.prompt && saved.prompt.key !== key) {
      const old = await this.fetchMessage(ch, saved.prompt.messageId);
      await old?.edit({ components: [] }).catch(() => undefined);
      delete saved.prompt;
      this.persist();
    }
    if (key && !saved.prompt) {
      const layout = this.opts.service.layout(boardId);
      const msg = promptMessage(boardId, state, layout, this.opts.loadConfig(), saved.imageMessageUrl);
      if (!msg) return;
      const files = [
        ...(await this.forkCloseup(boardId, state).catch((e) => {
          this.log("[board] fork close-up failed; sending the prompt without it", e);
          return [];
        })),
        ...this.advantageImage(boardId, state),
      ];
      const sent = await ch.send({ ...msg, files });
      saved.prompt = { messageId: sent.id, key };
      this.persist();
    }
  }

  // At a fork, a zoomed-in picture of where the player is, with an arrow per path
  // in its button's colour, so they can see what they're choosing between.
  private async forkCloseup(boardId: string, state: BoardState): Promise<AttachmentBuilder[]> {
    const c = state.move?.choice;
    if (c?.kind !== "fork") return [];
    const layout = this.opts.service.layout(boardId);
    const avatars = new Map<string, Image | null>();
    await Promise.all(state.turn.order.map(async (id) => avatars.set(id, await this.avatar(id))));
    const img = renderForkCloseup({
      layout,
      state,
      boardName: this.opts.service.summary(boardId).name,
      avatars,
      now: this.clock(),
      fork: c.spaceId,
      // the button label without its emoji arrow
      options: c.options.map((next) => ({ next, label: direction(layout, c.spaceId, next).split(" ").slice(1).join(" ") })),
    });
    return [new AttachmentBuilder(img, { name: "fork.jpg" })];
  }

  private advantageFile(boardId: string): { path: string; name: string } | null {
    const adv = this.opts.loadConfig().shop.advantage?.perBoard[boardId];
    if (!adv) return null;
    const dir = this.opts.advantageDir ?? join(__dirname, "..", "..", "..", "apps", "web", "public", "advantages");
    const path = join(dir, adv.image);
    return existsSync(path) ? { path, name: `tribe-advantage${adv.image.slice(adv.image.lastIndexOf("."))}` } : null;
  }

  // In a shop that still has the tribe advantage, its picture goes with the prompt.
  private advantageImage(boardId: string, state: BoardState): AttachmentBuilder[] {
    const c = state.move?.choice;
    if (c?.kind !== "shop") return [];
    const ctx = { layout: this.opts.service.layout(boardId), rules: this.opts.loadConfig() };
    if (!shopStock(ctx, state, c.stock).advantage) return [];
    const file = this.advantageFile(boardId);
    return file ? [new AttachmentBuilder(file.path, { name: file.name })] : [];
  }

  // Someone bought the tribe advantage: it isn't an in-game item, so the hosts hand it
  // out. Says who, which board and which advantage, and pings the host role.
  private async pingHostsAdvantage(boardId: string, playerId: string, price: number, state: BoardState) {
    const channelId = this.opts.hostPingChannelId;
    const adv = this.opts.loadConfig().shop.advantage?.perBoard[boardId];
    const text = `${bold(this.names(state)(playerId))} (<@${playerId}>) bought the tribe advantage on ${bold(this.opts.service.summary(boardId).name)}: ${bold(adv?.name ?? "the tribe advantage")}, ${price} coins. It needs handing over.`;
    if (!channelId) {
      await this.opts.logToHost?.(text);
      return;
    }
    const ch = await this.fetchChannel(channelId);
    if (!ch) {
      this.log(`[board] can't reach the host ping channel ${channelId}; tribe advantage bought on ${boardId} by ${playerId}`);
      await this.opts.logToHost?.(text);
      return;
    }
    const role = this.opts.hostRoleId;
    const file = this.advantageFile(boardId);
    await ch.send({
      content: role ? `<@&${role}> ${text}` : text,
      allowedMentions: { roles: role ? [role] : [], users: [] },
      files: file ? [new AttachmentBuilder(file.path, { name: file.name })] : [],
    });
  }

  // The last turn message's Roll button goes once it's been used or superseded.
  private async retireTurnMessage(ch: BoardChannel, boardId: string) {
    const old = await this.fetchMessage(ch, this.board(boardId).turnMessageId);
    if (old && old.components.length) await old.edit({ components: [] }).catch(() => undefined);
  }

  private async announceTurn(boardId: string, ch: BoardChannel, state: BoardState) {
    const saved = this.board(boardId);
    await this.retireTurnMessage(ch, boardId);
    const pid = currentPlayerId(state);
    if (!state.started || state.paused || state.move || !pid) return;
    const opens = state.turn.windowOpensAt;
    // Opening any moment now: skip "you're up next" and let the ping be the message.
    if (opens !== null && opens > this.clock() && opens - this.clock() < (this.opts.upNextMinMs ?? 120_000)) return;
    const ctx = { layout: this.opts.service.layout(boardId), rules: this.opts.loadConfig() };
    const msg = turnMessage(boardId, state, pid, this.clock(), usableItems(ctx, state, pid).length > 0);
    const sent = await ch.send(msg);
    saved.turnMessageId = sent.id;
    // Open now means this message was the ping; don't send a second one.
    if (msg.components.length) saved.pingedWindow = state.turn.windowOpensAt ?? 0;
    this.persist();
  }

  // Pings the player the moment their window opens (after the 4h cooldown).
  private schedulePing(boardId: string, state: BoardState) {
    const old = this.pingTimers.get(boardId);
    if (old) clearTimeout(old);
    const t = state.turn;
    const pid = currentPlayerId(state);
    if (!state.started || state.paused || state.move || !pid || t.windowOpensAt === null) return;
    if (this.board(boardId).pingedWindow === t.windowOpensAt) return;
    const opensAt = t.windowOpensAt;
    const delay = Math.min(Math.max(0, opensAt - this.clock()), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      void this.enqueue(boardId, async () => {
        const { state: now } = this.opts.service.state(boardId);
        if (now.turn.windowOpensAt !== opensAt || currentPlayerId(now) !== pid || now.move || now.paused) return;
        if (opensAt > this.clock()) return this.schedulePing(boardId, now); // long waits re-arm
        const ch = await this.feed(boardId);
        if (ch) await this.announceTurn(boardId, ch, now);
      });
    }, delay);
    timer.unref?.();
    this.pingTimers.set(boardId, timer);
  }

  private scheduleImage(boardId: string) {
    const old = this.imageTimers.get(boardId);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => void this.enqueue(boardId, () => this.refreshImage(boardId)), this.opts.imageDebounceMs ?? 1500);
    timer.unref?.();
    this.imageTimers.set(boardId, timer);
  }

  private async avatar(userId: string): Promise<Image | null> {
    try {
      const user = await this.opts.client.users.fetch(userId);
      const url = user.displayAvatarURL({ extension: "png", size: 64 });
      const hit = this.avatars.get(userId);
      if (hit?.url === url) return hit.img;
      const res = await fetch(url);
      const img = res.ok ? await loadImage(Buffer.from(await res.arrayBuffer())) : null;
      this.avatars.set(userId, { url, img });
      return img;
    } catch {
      return null; // falls back to an initial
    }
  }

  // Edits the board's one image message in place (or re-posts it at the bottom).
  async refreshImage(boardId: string, opts: { repost?: boolean } = {}) {
    const ch = await this.channel(boardId);
    if (!ch) return;
    const { state } = this.opts.service.state(boardId);
    const summary = this.opts.service.summary(boardId);
    const avatars = new Map<string, Image | null>();
    await Promise.all(state.turn.order.map(async (id) => avatars.set(id, await this.avatar(id))));
    const img = renderBoard({ layout: this.opts.service.layout(boardId), state, boardName: summary.name, avatars, now: this.clock(), shopVariants: this.opts.loadConfig().shop.variants });
    const files = [new AttachmentBuilder(img, { name: `${boardId}.jpg` })];
    const saved = this.board(boardId);
    if (this.opts.updatesThread?.enabled) await this.feed(boardId); // make sure the thread exists to link to
    const playIn = saved.threadId ? ` · play in <#${saved.threadId}>` : "";
    const content = `🗺️ ${bold(summary.name)} · updated ${ts(this.clock(), "R")}${playIn}`;
    const existing = await this.fetchMessage(ch, saved.imageMessageId);
    if (existing && !opts.repost) {
      await existing.edit({ content, files, attachments: [] } as MessageEditOptions);
      if (existing.url && saved.imageMessageUrl !== existing.url) {
        saved.imageMessageUrl = existing.url;
        this.persist();
      }
      return;
    }
    await existing?.delete().catch(() => undefined);
    const sent = await ch.send({ content, files, allowedMentions: NO_MENTIONS });
    saved.imageMessageId = sent.id;
    // linked from fork prompts so players can open the full board
    saved.imageMessageUrl = sent.url;
    this.persist();
  }

  // ---- interactions ----

  async handleRoll(interaction: ChatInputCommandInteraction) {
    const { service } = this.opts;
    const uid = interaction.user.id;
    const boardId = service.boardIdOf(uid);
    if (!boardId) return interaction.reply({ content: "You aren't on a board right now.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      await service.roll(uid, "discord");
    } catch (e) {
      return interaction.editReply(this.friendly(e));
    }
    const home = this.board(boardId).threadId ?? service.summary(boardId).channelId;
    // The roll itself shows up in the board's thread/channel; this private reply just gets out of the way.
    if (interaction.channelId === home || interaction.channelId === service.summary(boardId).channelId) {
      await interaction.deleteReply().catch(() => undefined);
    } else {
      await interaction.editReply(`Rolled. See <#${home}>.`);
    }
  }

  async handleButton(interaction: ButtonInteraction) {
    const { service } = this.opts;
    const action = parseButtonId(interaction.customId);
    if (!action) return;
    const uid = interaction.user.id;
    if (service.boardIdOf(uid) !== action.boardId) {
      return interaction.reply({ content: "That button isn't for you.", ephemeral: true });
    }
    const { state } = service.state(action.boardId);
    if (action.kind === "items" || action.kind === "use") return this.handleItems(interaction, action, state);
    if (action.kind !== "roll" && state.move?.playerId !== uid) {
      const owner = state.move ? this.names(state)(state.move.playerId) : null;
      return interaction.reply({ content: owner ? `That's ${owner}'s choice to make.` : "That choice has already been made.", ephemeral: true });
    }
    await interaction.deferUpdate();
    try {
      if (action.kind === "roll") {
        await service.roll(uid, "discord");
        await interaction.editReply({ components: [] }).catch(() => undefined);
      } else if (action.kind === "fork") await service.chooseFork(uid, action.next, "discord");
      else if (action.kind === "star") await (action.buy ? service.buyStar(uid, "discord") : service.skipStar(uid, "discord"));
      else if (action.kind === "event") await service.eventTarget(uid, action.targetId, "discord");
      else if (action.kind === "pick") await service.pickDie(uid, action.value, "discord");
      else if (action.kind === "shop") {
        if (!action.itemId) await service.shopSkip(uid, "discord");
        else {
          // the channel only hears "bought something"; the buyer hears what
          const out = await service.shopBuy(uid, action.itemId, "discord");
          const bought = out.find((s) => s.event.type === "ShopPurchase" || s.event.type === "AdvantagePurchased")?.event;
          if (bought) {
            const what = bought.type === "AdvantagePurchased" ? "the tribe advantage" : bold(this.itemName((bought as { itemId: string }).itemId));
            const after = service.state(action.boardId).state.players[uid];
            const bag = bought.type === "ShopPurchase" && after ? ` It's in your bag (${after.items.length}/${this.opts.loadConfig().shop.bagSize}).` : " The hosts have been told and will give it to you.";
            await interaction.followUp({ content: `You bought ${what}.${bag}`, ephemeral: true });
          }
        }
      }
    } catch (e) {
      await interaction.followUp({ content: this.friendly(e), ephemeral: true });
    }
  }

  // The Items button: a private menu of the player's usable items, then (for Poison and
  // the Boo Bell) who to use it on. A Crystal Ball answers privately with a picture.
  private async handleItems(
    interaction: ButtonInteraction,
    action: { kind: "items" } | { kind: "use"; itemId: string; targetId: string | null },
    state: BoardState,
  ) {
    const { service } = this.opts;
    const uid = interaction.user.id;
    const boardId = service.boardIdOf(uid)!;
    const config = this.opts.loadConfig();
    const ctx = { layout: service.layout(boardId), rules: config };
    const reply = (content: string, components: ActionRowBuilder<ButtonBuilder>[] = [], files: AttachmentBuilder[] = []) =>
      action.kind === "items"
        ? interaction.reply({ content, components, files, ephemeral: true })
        : interaction.update({ content, components, files });
    if (currentPlayerId(state) !== uid || state.move) return reply("You can use items on your turn, before you roll.");
    const held = (state.players[uid]?.items ?? []).map((id) => itemDef(ctx, id)).filter((i) => i && (i.effect.kind === "guard" || i.effect.kind === "starDiscount"));
    const heldNote = held.length ? `\n-# ${[...new Set(held.map((i) => i!.name))].join(" and ")} ${held.length === 1 ? "is" : "are"} used automatically when needed.` : "";
    if (action.kind === "items") {
      const usable = usableItems(ctx, state, uid);
      if (!usable.length) return reply(`You don't have anything to use right now.${heldNote}`);
      const counts = new Map<string, number>();
      for (const i of usable) counts.set(i.id, (counts.get(i.id) ?? 0) + 1);
      const buttons = [...counts].map(([id, n]) => {
        const item = itemDef(ctx, id)!;
        return new ButtonBuilder().setCustomId(buttonId({ kind: "use", boardId, itemId: id, targetId: null })).setLabel(`${item.name}${n > 1 ? ` ×${n}` : ""}`).setStyle(ButtonStyle.Primary);
      });
      const lines = [...counts.keys()].map((id) => `• ${bold(itemDef(ctx, id)!.name)}. ${itemDef(ctx, id)!.description ?? ""}`);
      return reply(`Your items. You can use one per turn, before you roll.\n${lines.join("\n")}${heldNote}`, [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(0, 5))]);
    }
    const item = itemDef(ctx, action.itemId);
    if (!item) return reply("That item doesn't exist anymore.");
    const needsTarget = item.effect.kind === "poison" || item.effect.kind === "steal";
    if (needsTarget && !action.targetId) {
      const others = state.turn.order.filter((id) => id !== uid && state.players[id]);
      const buttons = others.slice(0, 5).map((id) =>
        new ButtonBuilder()
          .setCustomId(buttonId({ kind: "use", boardId, itemId: item.id, targetId: id }))
          .setLabel(`${state.players[id].name}${item.effect.kind === "steal" ? ` (${state.players[id].coins} coins)` : ""}`.slice(0, 80))
          .setStyle(ButtonStyle.Danger),
      );
      return reply(`Who do you want to use the ${bold(item.name)} on?`, [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]);
    }
    try {
      const { nextStar } = await service.useItem(uid, item.id, action.targetId, "discord");
      if (nextStar) {
        const { state: now } = service.state(boardId);
        const img = renderSpotCloseup({ layout: ctx.layout, state: now, boardName: "", now: this.clock(), spaceId: nextStar });
        return reply(`The next time someone buys the star, it moves ${bold("here")}.`, [], [new AttachmentBuilder(img, { name: "next-star.jpg" })]);
      }
      return reply(`You used your ${bold(item.name)}.`);
    } catch (e) {
      return reply(this.friendly(e));
    }
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "item") return interaction.respond([]);
    const items = this.opts.loadConfig().shop.items;
    let pool = items.map((i) => ({ name: i.name, value: i.id }));
    if (interaction.options.getSubcommand() === "take") {
      const playerId = interaction.options.get("player")?.value as string | undefined;
      const boardId = playerId ? this.opts.service.boardIdOf(playerId) : null;
      const owned = boardId && playerId ? this.opts.service.state(boardId).state.players[playerId]?.items ?? [] : [];
      pool = [...new Set(owned)].map((id) => ({ name: this.itemName(id), value: id }));
    }
    const q = String(focused.value).toLowerCase();
    await interaction.respond(pool.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 25));
  }

  async handleHostCommand(interaction: ChatInputCommandInteraction) {
    const { service } = this.opts;
    const uid = interaction.user.id;
    if (!(await this.isHostInteraction(interaction))) {
      this.log(`[board] /board refused for ${interaction.user.tag} (${uid}): no host role ${this.opts.hostRoleId ?? "(none set)"} in this server, and not a host by config`);
      return interaction.reply({ content: "Only hosts can use /board.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    const boardOpt = () => interaction.options.getString("board", true);
    const playerOpt = () => interaction.options.getUser("player", true);
    const boardOfPlayer = (id: string, name: string) => {
      const b = service.boardIdOf(id);
      if (!b) throw new EngineError("unknown_player", `${name} isn't on a board.`);
      return b;
    };
    const host = (boardId: string, action: HostActionInput) => service.hostAction(boardId, action, uid, "discord");

    try {
      let events: StoredEvent[] = [];
      let boardId: string;
      let extra = "";
      switch (sub) {
        case "status":
          boardId = boardOpt();
          return await this.statusReply(interaction, boardId);
        case "start":
        case "pause":
        case "resume":
          boardId = boardOpt();
          events = await host(boardId, { type: sub === "start" ? "startBoard" : sub } as HostActionInput);
          break;
        case "send": {
          const user = playerOpt();
          boardId = boardOpt();
          const member = interaction.options.getMember("player") as { displayName?: string } | null;
          const reset = interaction.options.getBoolean("reset");
          const r = await service.transfer(user.id, boardId, uid, {
            name: member?.displayName ?? user.globalName ?? user.username,
            reset: reset ?? undefined,
            source: "discord",
          });
          extra = `${bold(r.player.name)} is on ${bold(service.summary(boardId).name)} with ${r.player.coins} coins, ${r.player.stars} stars, ${r.player.items.length} items.`;
          break;
        }
        case "remove": {
          const user = playerOpt();
          boardId = boardOfPlayer(user.id, user.username);
          events = await host(boardId, { type: "removePlayer", playerId: user.id });
          break;
        }
        case "coins":
        case "stars": {
          const user = playerOpt();
          boardId = boardOfPlayer(user.id, user.username);
          const amount = interaction.options.getInteger("amount", true);
          events = await host(boardId, sub === "coins" ? { type: "setCoins", playerId: user.id, coins: amount } : { type: "setStars", playerId: user.id, stars: amount });
          break;
        }
        case "give":
        case "take": {
          const user = playerOpt();
          boardId = boardOfPlayer(user.id, user.username);
          const itemId = interaction.options.getString("item", true);
          events = await host(boardId, { type: sub === "give" ? "grantItem" : "removeItem", playerId: user.id, itemId });
          break;
        }
        case "move": {
          const user = playerOpt();
          boardId = boardOfPlayer(user.id, user.username);
          events = await host(boardId, { type: "movePlayer", playerId: user.id, spaceId: interaction.options.getString("space", true).trim() });
          break;
        }
        case "star":
          boardId = boardOpt();
          events = await host(boardId, { type: "moveStar", spaceId: interaction.options.getString("space", true).trim() });
          break;
        case "order": {
          boardId = boardOpt();
          const order = [...interaction.options.getString("players", true).matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
          events = await host(boardId, { type: "setTurnOrder", order });
          break;
        }
        case "turn":
          boardId = boardOpt();
          events = await host(boardId, { type: interaction.options.getString("action", true) === "skip" ? "skipTurn" : "openTurnNow" });
          break;
        case "undo":
          boardId = boardOpt();
          events = await service.undo(
            boardId,
            { turn: interaction.options.getBoolean("turn") ?? false, count: interaction.options.getInteger("count") ?? undefined },
            uid,
            "discord",
          );
          break;
        case "refresh":
          boardId = boardOpt();
          await this.enqueue(boardId, () => this.refreshImage(boardId, { repost: true }));
          extra = "Board image re-posted.";
          break;
        default:
          return await interaction.editReply("Unknown subcommand.");
      }
      const { state } = service.state(boardId);
      const lines = events
        .map((e) => describeEvent(e.event as EngineEvent, (id) => bold(this.names(state)(id)), this.itemName))
        .filter((l): l is string => !!l);
      const text = [extra, ...lines].filter(Boolean).join("\n") || "Done.";
      await interaction.editReply(`✅ ${text}`);
      await this.opts.logToHost?.(`🎲 **${interaction.user.tag}** used \`/board ${sub}\` on ${service.summary(boardId).name}:\n${text}`);
    } catch (e) {
      await interaction.editReply(this.friendly(e));
    }
  }

  private async isHostInteraction(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const roleId = this.opts.hostRoleId;
    const roles = (interaction.member as { roles?: string[] | { cache?: Map<string, unknown> } } | null)?.roles;
    if (roleId && roles) {
      if (Array.isArray(roles) ? roles.includes(roleId) : roles.cache?.has(roleId)) return true;
    }
    return this.opts.isHost(interaction.user.id);
  }

  private async statusReply(interaction: ChatInputCommandInteraction, boardId: string) {
    const { service } = this.opts;
    const { state, seq } = service.state(boardId);
    const summary = service.summary(boardId);
    const t = state.turn;
    const pid = currentPlayerId(state);
    const lines = [
      `**${summary.name}** · ${state.started ? (state.paused ? "paused" : "running") : "not started"} · event #${seq}`,
      pid ? `Turn: ${bold(state.players[pid]?.name ?? pid)} · opens ${t.windowOpensAt ? ts(t.windowOpensAt) : "now"} · closes ${t.deadline ? ts(t.deadline) : "no limit"}` : "No players yet.",
      state.move?.choice ? `Waiting on: ${state.move.choice.kind} at ${state.move.choice.spaceId}` : "",
      `Star: ${state.star ?? "none"}`,
      "",
      ...t.order.map((id, i) => {
        const p = state.players[id];
        return `${i + 1}. ${bold(p.name)} <@${p.id}> · ${p.space} · ⭐ ${p.stars} · 🪙 ${p.coins} · ${p.items.map(this.itemName).join(", ") || "no items"}`;
      }),
    ].filter((l, i) => l !== "" || i === 4);
    const img = renderBoard({ layout: service.layout(boardId), state, boardName: summary.name, now: this.clock() });
    await interaction.editReply({ content: lines.join("\n"), files: [new AttachmentBuilder(img, { name: `${boardId}.jpg` })], allowedMentions: NO_MENTIONS });
  }
}

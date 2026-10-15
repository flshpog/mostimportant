import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AttachmentBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import { loadImage, type Image } from "@napi-rs/canvas";
import type { SeasonConfig } from "@everest/board-data";
import { currentPlayerId, describeEvent, EngineError, type BoardState, type EngineEvent } from "@everest/engine";
import { ServiceError, type ActionMeta, type BoardService, type HostActionInput, type StoredEvent, type WireEvent } from "@everest/server";
import { bold, narrate, parseButtonId, promptKey, promptMessage, rollButton, ts, turnMessage } from "./messages";
import { prepareBackdrops, renderBoard } from "./render";

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
  clock?: () => number;
  // Overridable so tests run fast.
  diceFrameMs?: number;
  imageDebounceMs?: number;
  // Defaults to fetching the board's channel from the client.
  getChannel?: (channelId: string) => Promise<BoardChannel | null>;
  log?: (message: string, error?: unknown) => void;
}

interface SavedBoard {
  imageMessageId?: string;
  threadId?: string;
  prompt?: { messageId: string; key: string };
  turnMessageId?: string;
  pingedWindow?: number;
}

const MAX_TIMER_MS = 2 ** 31 - 1;
const NO_MENTIONS = { parse: [] as never[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    return "Something went wrong on the board. Try again in a moment, or ask a host.";
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
      await ch.send({ content: "⏪ The hosts rewound the board.", allowedMentions: NO_MENTIONS });
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
    if (!meta.host) {
      const lines = narrate(events, this.names(state), this.itemName);
      const roll = events.find((e): e is Extract<EngineEvent, { type: "DiceRolled" }> => e.type === "DiceRolled");
      if (roll) {
        await this.retireTurnMessage(ch, boardId);
        await this.diceAnimation(ch, roll, state, lines);
      }
      else if (lines.length) await ch.send({ content: lines.join("\n"), allowedMentions: NO_MENTIONS });
    }
    await this.syncPrompt(boardId, ch, state);
    if (events.some((e) => e.type === "TurnStarted" || e.type === "BoardStarted")) await this.announceTurn(boardId, ch, state);
    this.schedulePing(boardId, state);
    this.scheduleImage(boardId);
  }

  // A few quick edits that land on the result the server already rolled.
  private async diceAnimation(ch: BoardChannel, roll: Extract<EngineEvent, { type: "DiceRolled" }>, state: BoardState, lines: string[]) {
    const who = bold(this.names(state)(roll.playerId));
    const frame = this.opts.diceFrameMs ?? 450;
    const { min, max } = this.opts.loadConfig().dice;
    const face = () => min + Math.floor(Math.random() * (max - min + 1)); // cosmetic only
    const msg = await ch.send({ content: `🎲 ${who} is rolling...`, allowedMentions: NO_MENTIONS });
    for (let i = 0; i < 2; i++) {
      await sleep(frame);
      await msg.edit({ content: `🎲 ${who} is rolling... ${bold(String(face()))}` });
    }
    await sleep(frame);
    const result = roll.dice.length > 1 ? `rolled ${roll.dice.join(" + ")} = ${bold(String(roll.total))}` : `rolled a ${bold(String(roll.total))}!`;
    await msg.edit({ content: [`🎲 ${who} ${result}`, ...lines].join("\n") });
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
      const msg = promptMessage(boardId, state, this.opts.service.layout(boardId), this.opts.loadConfig());
      if (!msg) return;
      const sent = await ch.send(msg);
      saved.prompt = { messageId: sent.id, key };
      this.persist();
    }
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
    const msg = turnMessage(boardId, state, pid, this.clock());
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
    const img = renderBoard({ layout: this.opts.service.layout(boardId), state, boardName: summary.name, avatars, now: this.clock() });
    const files = [new AttachmentBuilder(img, { name: `${boardId}.jpg` })];
    const saved = this.board(boardId);
    if (this.opts.updatesThread?.enabled) await this.feed(boardId); // make sure the thread exists to link to
    const playIn = saved.threadId ? ` · play in <#${saved.threadId}>` : "";
    const content = `🗺️ ${bold(summary.name)} · updated ${ts(this.clock(), "R")}${playIn}`;
    const existing = await this.fetchMessage(ch, saved.imageMessageId);
    if (existing && !opts.repost) {
      await existing.edit({ content, files, attachments: [] } as MessageEditOptions);
      return;
    }
    await existing?.delete().catch(() => undefined);
    const sent = await ch.send({ content, files, allowedMentions: NO_MENTIONS });
    saved.imageMessageId = sent.id;
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
      await interaction.editReply(`🎲 Rolled! See <#${home}>.`);
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
      else await (action.itemId ? service.shopBuy(uid, action.itemId, "discord") : service.shopSkip(uid, "discord"));
    } catch (e) {
      await interaction.followUp({ content: this.friendly(e), ephemeral: true });
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

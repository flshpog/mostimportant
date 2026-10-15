import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Board, SeasonConfig } from "@everest/board-data";
import { ADVANTAGE_ID, describeEvent, shopOffer, shopStock, type BoardState, type EngineEvent } from "@everest/engine";
import type { WireEvent } from "@everest/server";

// Button ids: board:<kind>:<boardId>:<value>. Board ids are [a-z-], values are space
// ids, item ids or buy/skip/leave, so ":" never appears inside a part.
export type ButtonAction =
  | { kind: "roll"; boardId: string }
  | { kind: "fork"; boardId: string; next: string }
  | { kind: "star"; boardId: string; buy: boolean }
  | { kind: "shop"; boardId: string; itemId: string | null }
  | { kind: "event"; boardId: string; targetId: string | null }
  // Custom Dice Block: take one of the two numbers.
  | { kind: "pick"; boardId: string; value: number }
  // Open your items (a private menu), then use one (on a target, for some).
  | { kind: "items"; boardId: string }
  | { kind: "use"; boardId: string; itemId: string; targetId: string | null };

const LEAVE = "__leave";
// Fork buttons, in order; render.ts colours each path's arrow to match.
const FORK_BUTTON_STYLES = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Secondary];
const PASS = "__pass";

export function buttonId(a: ButtonAction): string {
  switch (a.kind) {
    case "roll":
      return `board:roll:${a.boardId}:go`;
    case "fork":
      return `board:fork:${a.boardId}:${a.next}`;
    case "star":
      return `board:star:${a.boardId}:${a.buy ? "buy" : "skip"}`;
    case "shop":
      return `board:shop:${a.boardId}:${a.itemId ?? LEAVE}`;
    case "event":
      return `board:event:${a.boardId}:${a.targetId ?? PASS}`;
    case "pick":
      return `board:pick:${a.boardId}:${a.value}`;
    case "items":
      return `board:items:${a.boardId}:open`;
    case "use":
      return `board:use:${a.boardId}:${a.itemId}~${a.targetId ?? ""}`;
  }
}

export function parseButtonId(id: string): ButtonAction | null {
  const [prefix, kind, boardId, value] = id.split(":");
  if (prefix !== "board" || !boardId || !value) return null;
  if (kind === "roll") return { kind, boardId };
  if (kind === "fork") return { kind, boardId, next: value };
  if (kind === "star") return { kind, boardId, buy: value === "buy" };
  if (kind === "shop") return { kind, boardId, itemId: value === LEAVE ? null : value };
  if (kind === "event") return { kind, boardId, targetId: value === PASS ? null : value };
  if (kind === "pick") return { kind, boardId, value: Number(value) };
  if (kind === "items") return { kind, boardId };
  if (kind === "use") {
    const [itemId, targetId] = value.split("~");
    return { kind, boardId, itemId, targetId: targetId || null };
  }
  return null;
}

export const ts = (ms: number, style: "t" | "f" | "R" = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;
export const bold = (s: string) => `**${s.replace(/\*/g, "")}**`;

// Events whose text Discord shows elsewhere (dice animation, prompts, turn pings).
// Events get their own little scenes in the bridge (eventScene).
const SHOWN_ELSEWHERE = new Set([
  "DiceRolled",
  "TurnStarted",
  "ForkChoiceRequired",
  "StarOffered",
  "ShopOpened",
  "EventDrawn",
  "CoinsStolen",
  "StarStolen",
  "PlayersSwapped",
]);

// Plain-English lines for a batch of events, ready to post.
export function narrate(events: WireEvent[], names: (id: string) => string, items: (id: string) => string): string[] {
  return events
    .filter((e) => !SHOWN_ELSEWHERE.has(e.type))
    .map((e) => describeEvent(e as EngineEvent, (id) => bold(names(id)), items))
    .filter((l): l is string => !!l);
}

// "Up", "Down-left"... from the board's own layout, so fork buttons mean something.
export function direction(layout: Board, from: string, to: string): string {
  const a = layout.spaces.find((s) => s.id === from)!.pos;
  const b = layout.spaces.find((s) => s.id === to)!.pos;
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI; // 0 = right, 90 = up
  const dirs: [number, string, string][] = [
    [0, "➡️", "Right"],
    [45, "↗️", "Up-right"],
    [90, "⬆️", "Up"],
    [135, "↖️", "Up-left"],
    [180, "⬅️", "Left"],
    [-180, "⬅️", "Left"],
    [-135, "↙️", "Down-left"],
    [-90, "⬇️", "Down"],
    [-45, "↘️", "Down-right"],
  ];
  const [, emoji, word] = dirs.reduce((best, d) => (Math.abs(d[0] - deg) < Math.abs(best[0] - deg) ? d : best));
  return `${emoji} ${word}`;
}

// A key that changes whenever the pending prompt changes, so a stale prompt message
// can be retired and a new one posted.
export function promptKey(state: BoardState): string | null {
  const m = state.move;
  if (!m?.choice || m.choice.kind === "eventDraw" || m.choice.kind === "shopDraw") return null;
  return `${m.playerId}:${m.choice.kind}:${m.choice.spaceId}:${m.rolledAt}:${m.remaining}`;
}

export interface OutgoingMessage {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: { users: string[] };
}

function rows(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  const out: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += 5) {
    out.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return out;
}

// The prompt for whatever the current player has to decide, or null.
// `boardImageUrl` (the board picture's message link) turns "Which way?" into a link to it.
export function promptMessage(boardId: string, state: BoardState, layout: Board, config: SeasonConfig, boardImageUrl?: string): OutgoingMessage | null {
  const m = state.move;
  const c = m?.choice;
  if (!m || !c || c.kind === "eventDraw" || c.kind === "shopDraw") return null;
  const p = state.players[m.playerId];
  if (!p) return null;
  const who = `<@${p.id}>`;
  const until = `If you don't pick by ${ts(c.expiresAt, "t")} (${ts(c.expiresAt, "R")}), `;
  const mention = { users: [p.id] };

  if (c.kind === "fork") {
    // Button colours in order match the arrows on the close-up picture (FORK_PATH_COLOURS).
    const buttons = c.options.map((next, i) =>
      new ButtonBuilder()
        .setCustomId(buttonId({ kind: "fork", boardId, next }))
        .setLabel(direction(layout, c.spaceId, next))
        .setStyle(FORK_BUTTON_STYLES[i % FORK_BUTTON_STYLES.length]),
    );
    const which = boardImageUrl ? `[Which way?](${boardImageUrl})` : "Which way?";
    return {
      content: `🔀 ${who}, you're at a fork with ${bold(String(m.remaining))} step${m.remaining === 1 ? "" : "s"} left. ${bold(which)}\n-# ${until}you'll go ${direction(layout, c.spaceId, c.options[0])
        .split(" ")
        .slice(1)
        .join(" ")
        .toLowerCase()}.`,
      components: rows(buttons),
      allowedMentions: mention,
    };
  }
  if (c.kind === "star") {
    return {
      content: `⭐ ${who}, you reached the star! Buy it for ${bold(`${c.price} coins`)}? You have ${p.coins}.\n-# ${until}you'll pass on it.`,
      components: rows([
        new ButtonBuilder().setCustomId(buttonId({ kind: "star", boardId, buy: true })).setLabel(`Buy (${c.price} coins)`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(buttonId({ kind: "star", boardId, buy: false })).setLabel("No thanks").setStyle(ButtonStyle.Secondary),
      ]),
      allowedMentions: mention,
    };
  }
  if (c.kind === "coinSteal" || c.kind === "starSteal" || c.kind === "swap") {
    const targets = c.targets.map((id) => state.players[id]).filter((t) => !!t).slice(0, 24);
    const label = (t: (typeof targets)[number]) =>
      (c.kind === "coinSteal" ? `${t.name} (${t.coins} coins)` : c.kind === "starSteal" ? `${t.name} (${t.stars} ⭐)` : t.name).slice(0, 80);
    const buttons = targets.map((t) =>
      new ButtonBuilder().setCustomId(buttonId({ kind: "event", boardId, targetId: t.id })).setLabel(label(t)).setStyle(ButtonStyle.Primary),
    );
    if (c.kind !== "coinSteal") {
      buttons.push(new ButtonBuilder().setCustomId(buttonId({ kind: "event", boardId, targetId: null })).setLabel("No thanks").setStyle(ButtonStyle.Secondary));
    }
    const text =
      c.kind === "coinSteal"
        ? `💰 ${who}, ${bold("Coin Steal")}! Pick a tribemate. You'll take a random 5-50% of their coins.\n-# ${until}you'll steal from whoever has the most.`
        : c.kind === "starSteal"
          ? `🌟 ${who}, ${bold("Star Steal")}! Pay ${bold(`${c.price} coins`)} to take a star from someone? You have ${p.coins}.\n-# ${until}you'll pass on it.`
          : `🔄 ${who}, ${bold("Swap Places")}! Pick someone to trade spots with.\n-# ${until}you'll stay where you are.`;
    return { content: text, components: rows(buttons), allowedMentions: mention };
  }
  if (c.kind === "dicePick") {
    const buttons = c.options.map((value) =>
      new ButtonBuilder().setCustomId(buttonId({ kind: "pick", boardId, value })).setLabel(`Take ${value}`).setStyle(ButtonStyle.Primary),
    );
    return {
      content: `🎲 ${who}, your ${config.shop.items.find((i) => i.effect.kind === "reroll")?.name ?? "dice"} rolled ${c.options.map((v) => bold(String(v))).join(" and ")}. Which one?\n-# ${until}you'll take the higher one.`,
      components: rows(buttons),
      allowedMentions: mention,
    };
  }
  // the shop: what this one sells, what you can afford, and the tribe advantage
  const ctx = { layout, rules: config };
  const stock = shopStock(ctx, state, c.stock);
  const offer = shopOffer(ctx, state, c.stock, p.id);
  // This post is public, so it says nothing about the bag: every item the player has
  // the coins for gets a button, and a full bag is turned away privately.
  const affordable = stock.items.filter((i) => i.price <= p.coins);
  const canBuy = new Set(affordable.map((i) => i.id));
  const lines = stock.items.map((i) => `${canBuy.has(i.id) ? "•" : "◦"} ${bold(i.name)} · ${i.price} coins${i.description ? ` — ${i.description}` : ""}`);
  if (stock.advantage) {
    lines.push(
      `✦ ${bold(`Tribe Advantage: ${stock.advantage.name}`)} · ${stock.advantage.price} coins · one per tribe, doesn't take a bag slot`,
      ...(stock.advantage.description ? [`> ${stock.advantage.description}`] : []),
    );
  }
  const buttons = affordable
    .slice(0, 23)
    .map((i) => new ButtonBuilder().setCustomId(buttonId({ kind: "shop", boardId, itemId: i.id })).setLabel(`${i.name} (${i.price})`.slice(0, 80)).setStyle(ButtonStyle.Primary));
  if (offer.advantage && stock.advantage) {
    buttons.push(new ButtonBuilder().setCustomId(buttonId({ kind: "shop", boardId, itemId: ADVANTAGE_ID })).setLabel(`${stock.advantage.name} (${stock.advantage.price})`.slice(0, 80)).setStyle(ButtonStyle.Success));
  }
  buttons.push(new ButtonBuilder().setCustomId(buttonId({ kind: "shop", boardId, itemId: null })).setLabel("Leave the shop").setStyle(ButtonStyle.Secondary));
  const variant = layout.spaces.find((s) => s.id === c.spaceId)?.shop;
  const shopName = variant ? config.shop.variants[variant]?.name ?? "shop" : "shop";
  return {
    content: `🛍️ ${who}, welcome to the ${shopName.toLowerCase()}! You have ${bold(`${p.coins} coins`)}.\n${lines.join("\n")}\n-# ${until}you'll leave without buying.`,
    components: rows(buttons),
    allowedMentions: mention,
  };
}

// Roll, plus an Items button when the player has something they can use.
export function rollButton(boardId: string, withItems = false): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buttonId({ kind: "roll", boardId })).setLabel("Roll").setEmoji("🎲").setStyle(ButtonStyle.Success),
  );
  if (withItems) row.addComponents(new ButtonBuilder().setCustomId(buttonId({ kind: "items", boardId })).setLabel("Items").setEmoji("🎒").setStyle(ButtonStyle.Secondary));
  return row;
}

// Turn announcement. `open` = the player can roll right now.
export function turnMessage(boardId: string, state: BoardState, playerId: string, now: number, withItems = false): OutgoingMessage {
  const t = state.turn;
  const who = `<@${playerId}>`;
  const limit = t.deadline === null ? "There's no time limit on this one." : `You have until ${ts(t.deadline)} (${ts(t.deadline, "R")}).`;
  const open = t.windowOpensAt === null || t.windowOpensAt <= now;
  return open
    ? { content: `🎲 ${who}, it's your turn! ${limit}`, components: [rollButton(boardId, withItems)], allowedMentions: { users: [playerId] } }
    : {
        content: `⏳ ${who} is up next. Your turn opens ${ts(t.windowOpensAt!)} (${ts(t.windowOpensAt!, "R")}). I'll ping you then.`,
        components: [],
        allowedMentions: { users: [playerId] },
      };
}

import type { Board, SeasonConfig } from "@everest/board-data";

// The parts of season-config.json the engine reads. Passed in, never imported, so the
// engine stays pure and tests can tweak rules freely.
export type Rules = Pick<SeasonConfig, "coins" | "star" | "dice" | "turns" | "shop" | "events">;

export interface EngineContext {
  layout: Board;
  rules: Rules;
}

export interface PlayerState {
  id: string; // discord user id
  name: string;
  space: string;
  coins: number;
  stars: number;
  items: string[]; // shop item ids, repeats allowed
  // A tribemate's Poison Mushroom: the next roll is halved.
  poisoned?: boolean;
}

export type Choice =
  | { kind: "fork"; spaceId: string; options: string[]; expiresAt: number }
  | { kind: "star"; spaceId: string; price: number; expiresAt: number }
  // Reached a shop; the server draws what it sells this visit straight away.
  | { kind: "shopDraw"; spaceId: string }
  | { kind: "shop"; spaceId: string; bought: number; expiresAt: number; stock: string[] }
  // Landed on an event space; the server draws the event straight away.
  | { kind: "eventDraw"; spaceId: string }
  // The drawn event, waiting for the player to pick a target. `percent` is rolled at
  // draw time so a timeout can resolve it without randomness in the engine.
  | { kind: "coinSteal"; spaceId: string; targets: string[]; percent: number; expiresAt: number }
  | { kind: "starSteal"; spaceId: string; targets: string[]; price: number; expiresAt: number }
  | { kind: "swap"; spaceId: string; targets: string[]; expiresAt: number }
  // Custom Dice Block: pick one of two rolled numbers.
  | { kind: "dicePick"; spaceId: string; options: number[]; expiresAt: number };

export type ChoiceKind = Choice["kind"];
// Choices that wait on the player (and time out), as opposed to ones the server settles.
export type PlayerChoice = Exclude<Choice, { kind: "eventDraw" } | { kind: "shopDraw" }>;
export type EventChoiceKind = "coinSteal" | "starSteal" | "swap";

// A roll in progress. Movement pauses here while a choice is pending.
export interface MoveState {
  playerId: string;
  remaining: number;
  rolledAt: number;
  // Prompts already handled at the space the token just arrived on.
  arrival: { spaceId: string; starDone: boolean; shopDone: boolean } | null;
  choice: Choice | null;
}

export interface TurnState {
  order: string[];
  index: number;
  // The current player may roll from windowOpensAt until deadline (null = no limit).
  windowOpensAt: number | null;
  deadline: number | null;
}

export interface BoardState {
  boardId: string;
  layoutId: string;
  started: boolean;
  paused: boolean;
  pausedAt: number | null;
  star: string | null;
  players: Record<string, PlayerState>;
  turn: TurnState;
  move: MoveState | null;
  // The tribe advantage in this board's shops has been bought.
  advantageSold?: boolean;
  // Where the star goes when it's next bought, once a Crystal Ball has asked
  // (chosen by the server ahead of time). The server never sends it to players.
  nextStar?: string | null;
  // The current player has used an item this turn (one per turn).
  itemUsed?: boolean;
  // A dice item waiting for the current player's roll.
  pendingRoll?: { playerId: string; itemId: string } | null;
}

export type CoinReason = "blue" | "red" | "green" | "star" | "shop" | "event" | "item" | "host";

export type EngineEvent =
  | { type: "BoardStarted"; order: string[] }
  | { type: "BoardPaused" }
  | { type: "BoardResumed" }
  | { type: "TurnStarted"; playerId: string; windowOpensAt: number; deadline: number | null }
  | { type: "TurnSkipped"; playerId: string; byHost?: boolean }
  | { type: "TurnEnded"; playerId: string }
  // `item`: the dice item used. `choose`: a Custom Dice Block, the player picks one of
  // `dice` next. `halvedFrom`: a poisoned roll, halved from this total.
  | { type: "DiceRolled"; playerId: string; dice: number[]; total: number; item?: string; choose?: boolean; halvedFrom?: number }
  | { type: "DiePicked"; playerId: string; value: number; total: number; halvedFrom?: number; auto: boolean }
  | { type: "PlayerMoved"; playerId: string; from: string; to: string; remaining: number }
  | { type: "ForkChoiceRequired"; playerId: string; spaceId: string; options: string[]; remaining: number }
  | { type: "ForkChosen"; playerId: string; spaceId: string; next: string; auto: boolean }
  | { type: "PassedSpace"; playerId: string; spaceId: string; spaceType: string }
  | { type: "LandedOnSpace"; playerId: string; spaceId: string; spaceType: string }
  | { type: "CoinsChanged"; playerId: string; delta: number; coins: number; reason: CoinReason }
  | { type: "StarsChanged"; playerId: string; delta: number; stars: number; reason: "star" | "event" | "host" }
  | { type: "StarOffered"; playerId: string; spaceId: string; price: number }
  | { type: "StarUnaffordable"; playerId: string; spaceId: string; price: number; coins: number }
  | { type: "StarPurchased"; playerId: string; spaceId: string; price: number; discount?: number }
  | { type: "StarSkipped"; playerId: string; auto: boolean }
  | { type: "StarMoved"; from: string | null; to: string; by: "purchase" | "host" }
  | { type: "ShopOpened"; playerId: string; spaceId: string; affordable: string[] }
  | { type: "ShopUnaffordable"; playerId: string; spaceId: string; bagFull?: boolean }
  | { type: "AdvantagePurchased"; playerId: string; price: number }
  | { type: "ItemUsed"; playerId: string; itemId: string; targetId?: string }
  // A held item doing its job by itself (Blue Shell, Magic Lamp), and gone.
  | { type: "ItemSpent"; playerId: string; itemId: string }
  | { type: "StealBlocked"; playerId: string; targetId: string; by: "coinSteal" | "starSteal" | "item" }
  | { type: "BooBellRang"; playerId: string; targetId: string; amount: number }
  | { type: "ShopPurchase"; playerId: string; itemId: string; price: number }
  | { type: "ShopClosed"; playerId: string; auto: boolean }
  | { type: "EventDrawn"; playerId: string; spaceId: string; event: EventChoiceKind; targets: string[] }
  // The drawn event couldn't happen: nobody to target, nobody with a star, or too poor.
  | { type: "EventFizzled"; playerId: string; event: EventChoiceKind | null; reason: "no_events" | "no_targets" | "no_stars" | "too_poor"; price?: number }
  | { type: "EventDeclined"; playerId: string; event: EventChoiceKind; auto: boolean }
  | { type: "CoinsStolen"; playerId: string; targetId: string; percent: number; amount: number; auto: boolean }
  | { type: "StarStolen"; playerId: string; targetId: string; price: number }
  | { type: "PlayersSwapped"; playerId: string; targetId: string; playerTo: string; targetTo: string }
  | { type: "PlayerAdded"; playerId: string; spaceId: string }
  | { type: "PlayerRemoved"; playerId: string; player: PlayerState }
  | { type: "PlayerTeleported"; playerId: string; from: string; to: string }
  | { type: "ItemGranted"; playerId: string; itemId: string }
  | { type: "ItemRemoved"; playerId: string; itemId: string }
  | { type: "TurnOrderSet"; order: string[] };

export interface ActionResult {
  state: BoardState;
  events: EngineEvent[];
}

// Every action carries `now` (ms since epoch). The engine never reads the clock and
// never rolls dice; the server supplies both, which keeps replays exact.
export type Action =
  | { type: "startBoard"; now: number }
  | { type: "tick"; now: number }
  | { type: "roll"; playerId: string; dice: number[]; now: number }
  | { type: "chooseFork"; playerId: string; next: string; now: number }
  | { type: "buyStar"; playerId: string; newStarSpace: string; now: number }
  | { type: "skipStar"; playerId: string; now: number }
  | { type: "shopBuy"; playerId: string; itemId: string; now: number }
  | { type: "shopSkip"; playerId: string; now: number }
  // Use an item before rolling. The server fills in nextStarSpace for a Crystal Ball.
  | { type: "useItem"; playerId: string; itemId: string; targetId?: string | null; nextStarSpace?: string; now: number }
  | { type: "pickDie"; playerId: string; value: number; now: number }
  // Server-only: settles a shopDraw with the items this shop offers this visit.
  | { type: "stockShop"; playerId: string; items: string[]; now: number }
  // Server-only: settles an eventDraw with the event it drew (and the coin-steal roll).
  | { type: "drawEvent"; playerId: string; event: EventChoiceKind; percent: number; now: number }
  // Player picks the event's target, or null to decline (not allowed for coin steal).
  | { type: "eventTarget"; playerId: string; targetId: string | null; now: number }
  // host actions
  | { type: "setCoins"; playerId: string; coins: number; now: number }
  | { type: "setStars"; playerId: string; stars: number; now: number }
  | { type: "grantItem"; playerId: string; itemId: string; now: number }
  | { type: "removeItem"; playerId: string; itemId: string; now: number }
  | { type: "movePlayer"; playerId: string; spaceId: string; now: number }
  | { type: "moveStar"; spaceId: string; now: number }
  | { type: "addPlayer"; player: { id: string; name: string; coins?: number; stars?: number; items?: string[] }; spaceId?: string; now: number }
  | { type: "removePlayer"; playerId: string; now: number }
  | { type: "setTurnOrder"; order: string[]; now: number }
  // Opens the current player's window right now (ends their cooldown early).
  | { type: "openTurnNow"; now: number }
  // Skips the current player; the next player's window opens right now.
  | { type: "skipTurn"; now: number }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number };

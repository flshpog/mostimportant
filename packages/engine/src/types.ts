import type { Board, SeasonConfig } from "@everest/board-data";

// The parts of season-config.json the engine reads. Passed in, never imported, so the
// engine stays pure and tests can tweak rules freely.
export type Rules = Pick<SeasonConfig, "coins" | "star" | "dice" | "turns" | "shop" | "bowser">;

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
}

export type Choice =
  | { kind: "fork"; spaceId: string; options: string[]; expiresAt: number }
  | { kind: "star"; spaceId: string; price: number; expiresAt: number }
  | { kind: "shop"; spaceId: string; bought: number; expiresAt: number }
  | { kind: "bowser"; spaceId: string };

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
}

export type CoinReason = "blue" | "red" | "green" | "star" | "shop" | "bowser" | "host";

export type EngineEvent =
  | { type: "BoardStarted"; order: string[] }
  | { type: "BoardPaused" }
  | { type: "BoardResumed" }
  | { type: "TurnStarted"; playerId: string; windowOpensAt: number; deadline: number | null }
  | { type: "TurnSkipped"; playerId: string; byHost?: boolean }
  | { type: "TurnEnded"; playerId: string }
  | { type: "DiceRolled"; playerId: string; dice: number[]; total: number }
  | { type: "PlayerMoved"; playerId: string; from: string; to: string; remaining: number }
  | { type: "ForkChoiceRequired"; playerId: string; spaceId: string; options: string[]; remaining: number }
  | { type: "ForkChosen"; playerId: string; spaceId: string; next: string; auto: boolean }
  | { type: "PassedSpace"; playerId: string; spaceId: string; spaceType: string }
  | { type: "LandedOnSpace"; playerId: string; spaceId: string; spaceType: string }
  | { type: "CoinsChanged"; playerId: string; delta: number; coins: number; reason: CoinReason }
  | { type: "StarsChanged"; playerId: string; delta: number; stars: number; reason: "star" | "bowser" | "host" }
  | { type: "StarOffered"; playerId: string; spaceId: string; price: number }
  | { type: "StarUnaffordable"; playerId: string; spaceId: string; price: number; coins: number }
  | { type: "StarPurchased"; playerId: string; spaceId: string; price: number }
  | { type: "StarSkipped"; playerId: string; auto: boolean }
  | { type: "StarMoved"; from: string | null; to: string; by: "purchase" | "host" }
  | { type: "ShopOpened"; playerId: string; spaceId: string; affordable: string[] }
  | { type: "ShopUnaffordable"; playerId: string; spaceId: string }
  | { type: "ShopPurchase"; playerId: string; itemId: string; price: number }
  | { type: "ShopClosed"; playerId: string; auto: boolean }
  | { type: "BowserSpinRequired"; playerId: string; spaceId: string }
  | { type: "BowserSpin"; playerId: string; outcomeId: string; label: string }
  | { type: "BowserNoWheel"; playerId: string; spaceId: string }
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
  | { type: "spinBowser"; playerId: string; outcomeId: string; now: number }
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

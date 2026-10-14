export type EngineErrorCode =
  | "not_started"
  | "already_started"
  | "paused"
  | "not_your_turn"
  | "cooldown"
  | "busy"
  | "no_pending_choice"
  | "wrong_choice"
  | "invalid_dice"
  | "invalid_space"
  | "invalid_star_space"
  | "not_enough_coins"
  | "unknown_item"
  | "unknown_player"
  | "duplicate_player"
  | "invalid_order"
  | "invalid_amount";

// Thrown for rejected actions. `message` is plain language, safe to show a player.
export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

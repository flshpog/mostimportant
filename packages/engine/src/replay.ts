import { apply } from "./engine";
import type { Action, ActionResult, BoardState, EngineContext, EngineEvent } from "./types";

// The server stores a board as its initial state plus every accepted action. State
// is always rebuildable from that, so undo is "drop actions and replay".
export interface GameLog {
  initial: BoardState;
  actions: Action[];
}

export function replay(ctx: EngineContext, log: GameLog): ActionResult {
  let state = log.initial;
  const events: EngineEvent[] = [];
  for (const action of log.actions) {
    const r = apply(ctx, state, action);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

// Drops the last `count` actions.
export function undo(ctx: EngineContext, log: GameLog, count = 1): { log: GameLog; state: BoardState } {
  const next = { initial: log.initial, actions: log.actions.slice(0, Math.max(0, log.actions.length - count)) };
  return { log: next, state: replay(ctx, next).state };
}

// Drops the most recent roll and every action after it (its choices, ticks, host
// edits), putting the board back to just before that player rolled.
export function undoTurn(ctx: EngineContext, log: GameLog): { log: GameLog; state: BoardState } {
  const i = log.actions.map((a) => a.type).lastIndexOf("roll");
  return undo(ctx, log, i < 0 ? 0 : log.actions.length - i);
}

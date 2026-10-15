import { useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState, currentPlayerId, describeEvent, type Action, type BoardState, type EngineEvent } from "@everest/engine";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";
import { BoardHud } from "./BoardHud";
import { DiceOverlay } from "./DiceRoll";
import { useBoardAnimations } from "./useBoardAnimations";

const season = loadSeasonConfig();
// The preview ignores cooldowns so you can roll as fast as you like.
const rules = { ...season, turns: { ...season.turns, cooldownHours: 0 } };

// #/preview: the 3D board with a few made-up players and no server, for checking the
// scene and the animations on any device without logging in. Roll plays locally; every
// player rolls in turn and prompts take their default answer.
export function Preview() {
  const layout = loadLayouts().main;
  const ctx = useMemo(() => ({ layout, rules }), [layout]);
  const [state, setState] = useState<BoardState>(() => {
    let s = createBoardState(ctx, {
      boardId: "preview",
      starSpace: "s62",
      players: [
        { id: "p1", name: "Peach" },
        { id: "p2", name: "Toad" },
        { id: "p3", name: "Yoshi" },
        { id: "p4", name: "Daisy" },
      ],
    });
    s = apply(ctx, s, { type: "startBoard", now: 0 }).state;
    for (const [id, space] of [["p1", "s45"], ["p2", "s45"], ["p3", "s88"], ["p4", "s12"]] as const) {
      s = apply(ctx, s, { type: "movePlayer", playerId: id, spaceId: space, now: 0 }).state;
    }
    return s;
  });
  const [feed, setFeed] = useState<{ seq: number; text: string }[]>([]);
  const seq = useRef(0);
  const animator = useRef(new TokenAnimator()).current;
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  const [followTurns, setFollowTurns] = useState(true);
  const { play, popups, dice, clearDice } = useBoardAnimations({ animator, season, followTurns, setMode });

  const roll = () => {
    if (state.move || dice) return;
    const pid = currentPlayerId(state);
    if (!pid) return;
    const now = Date.now();
    const events: EngineEvent[] = [];
    const step = (s: BoardState, a: Action) => {
      const r = apply(ctx, s, a);
      events.push(...r.events);
      return r.state;
    };
    const d = season.dice.min + Math.floor(Math.random() * (season.dice.max - season.dice.min + 1));
    let s = step(state, { type: "roll", playerId: pid, dice: [d], now });
    for (let i = 0; s.move?.choice && i < 50; i++) {
      const c = s.move.choice;
      if (c.kind === "fork") s = step(s, { type: "chooseFork", playerId: pid, next: c.options[Math.floor(Math.random() * c.options.length)], now });
      else if (c.kind === "star") s = step(s, { type: "skipStar", playerId: pid, now });
      else if (c.kind === "shop") s = step(s, { type: "shopSkip", playerId: pid, now });
      else if (c.kind === "eventDraw") s = step(s, { type: "drawEvent", playerId: pid, event: "swap", percent: 25, now });
      else if (c.kind === "coinSteal") s = step(s, { type: "eventTarget", playerId: pid, targetId: c.targets[0], now });
      else s = step(s, { type: "eventTarget", playerId: pid, targetId: c.targets[0] ?? null, now });
    }
    // the next player's window opens at once
    if (s.started && !s.move) s = { ...s, turn: { ...s.turn, windowOpensAt: now } };
    const nameOf = (id: string) => s.players[id]?.name ?? "someone";
    const lines = events.map((e) => describeEvent(e, nameOf)).filter((l): l is string => !!l);
    setFeed((f) => [...lines.map((text) => ({ seq: ++seq.current, text })).reverse(), ...f].slice(0, 6));
    play(events as never, s, layout, "p1");
    setState(s);
  };

  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={layout} state={state} meId="p1" avatars={{}} animator={animator} popups={popups} mode={mode} setMode={setMode} quality={window.location.hash.includes("lite") ? "lite" : "full"} />
      </div>
      <DiceOverlay roll={dice} onDone={clearDice} />
      <BoardHud
        boardName="Preview"
        boards={[{ id: "preview", name: "Preview" }]}
        boardId="preview"
        onBoard={() => undefined}
        status="live"
        state={state}
        layout={layout}
        season={season}
        meId={currentPlayerId(state) ?? "p1"}
        mode={mode}
        setMode={setMode}
        followTurns={followTurns}
        setFollowTurns={setFollowTurns}
        error={null}
        feed={feed}
        actions={{ roll, fork: () => undefined, star: () => undefined, shop: () => undefined, event: () => undefined }}
      />
    </div>
  );
}

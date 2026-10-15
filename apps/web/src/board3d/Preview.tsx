import { useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState, currentPlayerId, describeEvent, starCandidates, type Action, type BoardState, type EngineEvent } from "@everest/engine";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";
import { BoardHud } from "./BoardHud";
import { Banner } from "./Banner";
import { DiceOverlay } from "./DiceRoll";
import { useBoardAnimations } from "./useBoardAnimations";

const season = loadSeasonConfig();
// The preview ignores cooldowns so you can roll as fast as you like.
const rules = { ...season, turns: { ...season.turns, cooldownHours: 0 } };

// #/preview: the 3D board with a few made-up players and no server, for checking the
// scene and the animations on any device without logging in. Roll plays locally; every
// player rolls in turn; forks, the star and events wait for their buttons, the shop
// is skipped.
export function Preview() {
  const layout = loadLayouts().main;
  const ctx = useMemo(() => ({ layout, rules }), [layout]);
  const [state, setState] = useState<BoardState>(() => {
    let s = createBoardState(ctx, {
      boardId: "preview",
      starSpace: "s62",
      players: [
        { id: "p1", name: "Peach", coins: 30 },
        { id: "p2", name: "Toad", coins: 30 },
        { id: "p3", name: "Yoshi", coins: 30 },
        { id: "p4", name: "Daisy", coins: 30 },
      ],
    });
    s = apply(ctx, s, { type: "startBoard", now: 0 }).state;
    // #/preview?star puts Peach right before the star, to try the star cutscene
    // and ?fork puts her just before the s03 fork
    const hash = window.location.hash;
    // and ?event puts her just before the s21 event space (her first roll is a 1)
    const p1Start = hash.includes("star") ? "s61" : hash.includes("fork") ? "s02" : hash.includes("event") ? "s20" : "s45";
    for (const [id, space] of [["p1", p1Start], ["p2", "s45"], ["p3", "s88"], ["p4", "s12"]] as const) {
      s = apply(ctx, s, { type: "movePlayer", playerId: id, spaceId: space, now: 0 }).state;
    }
    return s;
  });
  const [feed, setFeed] = useState<{ seq: number; text: string }[]>([]);
  const seq = useRef(0);
  const firstRoll = useRef(true);
  const animator = useRef(new TokenAnimator()).current;
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  const [followTurns, setFollowTurns] = useState(true);
  const { play, popups, dice, clearDice, banner, clearBanner, starDirector, settled } = useBoardAnimations({ animator, season, followTurns, setMode });

  // Applies a player's action, then answers every prompt except the star (which waits
  // for the HUD buttons) with a default, and plays the result.
  const act = (make: (s: BoardState, now: number) => Action | null) => {
    const now = Date.now();
    const events: EngineEvent[] = [];
    const step = (s: BoardState, a: Action) => {
      const r = apply(ctx, s, a);
      events.push(...r.events);
      return r.state;
    };
    const first = make(state, now);
    if (!first) return;
    let s = step(state, first);
    // the shop and the event draw answer themselves; everything else waits for a click
    for (let i = 0; (s.move?.choice?.kind === "shop" || s.move?.choice?.kind === "eventDraw") && i < 50; i++) {
      const pid = s.move!.playerId;
      if (s.move!.choice!.kind === "shop") s = step(s, { type: "shopSkip", playerId: pid, now });
      else {
        const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
        s = step(s, { type: "drawEvent", playerId: pid, event: pick(["coinSteal", "starSteal", "swap"] as const), percent: pick(season.events.coinSteal.percents), now });
      }
    }
    // the next player's window opens at once
    if (s.started && !s.move) s = { ...s, turn: { ...s.turn, windowOpensAt: now } };
    const nameOf = (id: string) => s.players[id]?.name ?? "someone";
    const lines = events.map((e) => describeEvent(e, nameOf)?.replace(/\p{Extended_Pictographic}️?\s*/gu, "")).filter((l): l is string => !!l);
    setFeed((f) => [...lines.map((text) => ({ seq: ++seq.current, text })).reverse(), ...f].slice(0, 6));
    play(events as never, s, layout, currentPlayerId(state));
    setState(s);
  };

  const roll = () =>
    act((s, now) => {
      const pid = currentPlayerId(s);
      if (s.move || dice || !pid) return null;
      const first = firstRoll.current;
      firstRoll.current = false;
      const d = first && window.location.hash.includes("event") ? 1 : season.dice.min + Math.floor(Math.random() * (season.dice.max - season.dice.min + 1));
      return { type: "roll", playerId: pid, dice: [d], now };
    });
  const fork = (next: string) =>
    act((s, now) => {
      const pid = s.move?.playerId;
      return pid ? { type: "chooseFork", playerId: pid, next, now } : null;
    });
  const event = (targetId: string | null) =>
    act((s, now) => {
      const pid = s.move?.playerId;
      return pid ? { type: "eventTarget", playerId: pid, targetId, now } : null;
    });
  const star = (buy: boolean) =>
    act((s, now) => {
      const pid = s.move?.playerId;
      if (!pid) return null;
      if (!buy) return { type: "skipStar", playerId: pid, now };
      const spots = starCandidates(ctx, s);
      return { type: "buyStar", playerId: pid, newStarSpace: spots[Math.floor(Math.random() * spots.length)], now };
    });

  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={layout} state={state} meId={currentPlayerId(state) ?? "p1"} avatars={{}} animator={animator} starDirector={starDirector} ready={settled} onFork={fork} popups={popups} mode={mode} setMode={setMode} quality={window.location.hash.includes("lite") ? "lite" : "full"} />
      </div>
      <DiceOverlay roll={dice} onDone={clearDice} />
      <Banner banner={banner} onDone={clearBanner} />
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
        ready={settled}
        feed={feed}
        actions={{ roll, fork, star, shop: () => undefined, event }}
      />
    </div>
  );
}

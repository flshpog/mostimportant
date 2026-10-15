import { useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState, currentPlayerId, describeEvent, itemDef, starCandidates, type Action, type BoardState, type EngineEvent } from "@everest/engine";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";
import { BoardHud } from "./BoardHud";
import { Banner } from "./Banner";
import { EventReveal, StealWheel } from "./EventOverlays";
import { DiceOverlay } from "./DiceRoll";
import { useBoardAnimations } from "./useBoardAnimations";

const season = loadSeasonConfig();
// The preview ignores cooldowns so you can roll as fast as you like.
const rules = { ...season, turns: { ...season.turns, cooldownHours: 0 } };

// #/preview: the 3D board with a few made-up players and no server, for checking the
// scene and the animations on any device without logging in. Roll plays locally; every
// player rolls in turn; forks, the star and events wait for their buttons, the shop
// is skipped.
// ?board=merge (Yoshi's Island) or ?board=underworld (Redemption Island) previews
// those boards instead of the tribe board.
const PREVIEW_BOARDS: Record<string, { boardId: string; name: string; star: string | null; starts: [string, string, string, string] }> = {
  main: { boardId: "mario-stadium", name: "Preview", star: "s62", starts: ["s45", "s45", "s88", "s12"] },
  merge: { boardId: "merge", name: "Yoshi's Island", star: "s38", starts: ["s05", "s05", "s24", "s50"] },
  underworld: { boardId: "redemption-island", name: "The Underworld", star: null, starts: ["s03", "s03", "s12", "s22"] },
};
const previewBoard = () => window.location.hash.match(/board=(merge|underworld)/)?.[1] ?? "main";

export function Preview() {
  const which = previewBoard();
  const board = PREVIEW_BOARDS[which];
  const layout = loadLayouts()[which];
  const ctx = useMemo(() => ({ layout, rules }), [layout]);
  const [state, setState] = useState<BoardState>(() => {
    let s = createBoardState(ctx, {
      // a real board id, so its shops stock that board's tribe advantage
      boardId: board.boardId,
      starSpace: board.star,
      players: [
        // a mid-game spread, so every event has something to work with: Peach can
        // afford a star or a star steal, and Toad and Yoshi have stars to take
        { id: "p1", name: "Peach", coins: 60, stars: 1, items: ["star-compass", "boo-bell"] },
        { id: "p2", name: "Toad", coins: 35, stars: 2 },
        { id: "p3", name: "Yoshi", coins: 18, stars: 1 },
        { id: "p4", name: "Daisy", coins: 44 },
      ],
    });
    s = apply(ctx, s, { type: "startBoard", now: 0 }).state;
    // #/preview?star puts Peach right before the star, to try the star cutscene
    // and ?fork puts her just before the s03 fork
    const hash = window.location.hash;
    // and ?event puts her just before the s21 event space (her first roll is a 1)
    // and ?shop just before the purple bottom-left shop (?pinkshop: the pink top one)
    const p1Start = which !== "main"
      ? board.starts[0]
      : hash.includes("event")
      ? "s20"
      : hash.includes("star")
        ? "s61"
        : hash.includes("fork")
          ? "s02"
          : hash.includes("pinkshop")
            ? "s13"
            : hash.includes("shop")
              ? "s42"
              : "s45";
    for (const [id, space] of [["p1", p1Start], ["p2", board.starts[1]], ["p3", board.starts[2]], ["p4", board.starts[3]]] as const) {
      s = apply(ctx, s, { type: "movePlayer", playerId: id, spaceId: space, now: 0 }).state;
    }
    return s;
  });
  const [feed, setFeed] = useState<{ seq: number; text: string }[]>([]);
  const seq = useRef(0);
  const firstRoll = useRef(true);
  const [compass, setCompass] = useState<string | null>(null);
  const animator = useRef(new TokenAnimator()).current;
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  const [followTurns, setFollowTurns] = useState(true);
  const { play, popups, dice, clearDice, banner, clearBanner, starDirector, flights, settled, reveal, clearReveal, wheel, clearWheel, hold } = useBoardAnimations({ animator, season, followTurns, setMode });

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
    for (let i = 0; (s.move?.choice?.kind === "eventDraw" || s.move?.choice?.kind === "shopDraw") && i < 50; i++) {
      const pid = s.move!.playerId;
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
      if (s.move!.choice!.kind === "shopDraw") {
        // like the server: a couple of distinct items at random
        const pool = season.shop.items.map((x) => x.id);
        const items: string[] = [];
        while (items.length < Math.min(season.shop.stockSize, pool.length)) items.push(pick(pool.filter((x) => !items.includes(x))));
        s = step(s, { type: "stockShop", playerId: pid, items, now });
      } else {
        // ?event=coinSteal (or starSteal, swap) forces the draw
        const forced = window.location.hash.match(/event=(coinSteal|starSteal|swap)/)?.[1] as "coinSteal" | "starSteal" | "swap" | undefined;
        s = step(s, { type: "drawEvent", playerId: pid, event: forced ?? pick(["coinSteal", "starSteal", "swap"] as const), percent: pick(season.events.coinSteal.percents), now });
      }
    }
    // the next player's window opens at once
    if (s.started && !s.move) s = { ...s, turn: { ...s.turn, windowOpensAt: now } };
    const nameOf = (id: string) => s.players[id]?.name ?? "someone";
    const lines = events.map((e) => describeEvent(e, nameOf)?.replace(/\p{Extended_Pictographic}\p{Variation_Selector}?\s*/gu, "")).filter((l): l is string => !!l);
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
  const shop = (itemId: string | null) =>
    act((s, now) => {
      const pid = s.move?.playerId;
      if (!pid) return null;
      return itemId ? { type: "shopBuy", playerId: pid, itemId, now } : { type: "shopSkip", playerId: pid, now };
    });
  const item = (itemId: string, targetId: string | null) =>
    act((s, now) => {
      const pid = currentPlayerId(s);
      if (!pid) return null;
      // a Star Compass: the preview picks the next star spot like the server would
      const spots = starCandidates(ctx, s);
      const nextStarSpace = s.nextStar ?? spots[Math.floor(Math.random() * spots.length)];
      if (itemDef(ctx, itemId)?.effect.kind === "compass") {
        setCompass(nextStarSpace);
        setMode({ kind: "star", at: nextStarSpace });
      }
      return { type: "useItem", playerId: pid, itemId, targetId, nextStarSpace, now };
    });
  const pick = (value: number) =>
    act((s, now) => {
      const pid = s.move?.playerId;
      return pid ? { type: "pickDie", playerId: pid, value, now } : null;
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
    <div className={`board-page ${layout.world?.theme === "night" ? "night" : ""}`}>
      <div className="board-canvas">
        <Board3D layout={layout} state={state} meId={currentPlayerId(state) ?? "p1"} avatars={{}} animator={animator} starDirector={starDirector} flights={flights} ghostStar={compass && compass !== state.star ? compass : null} ready={settled} onFork={fork} popups={popups} mode={mode} setMode={setMode} quality={window.location.hash.includes("lite") ? "lite" : "full"} />
      </div>
      <DiceOverlay roll={dice} onDone={clearDice} />
      <Banner banner={banner} onDone={clearBanner} />
      <EventReveal show={reveal} onDone={clearReveal} />
      <StealWheel show={wheel} onDone={clearWheel} />
      <BoardHud
        boardName={board.name}
        boards={[{ id: "preview", name: "Preview" }]}
        boardId="preview"
        onBoard={() => undefined}
        status="live"
        state={hold("state", state)}
        layout={layout}
        season={season}
        meId={currentPlayerId(state) ?? "p1"}
        mode={mode}
        setMode={setMode}
        followTurns={followTurns}
        setFollowTurns={setFollowTurns}
        error={null}
        ready={settled}
        feed={hold("feed", feed)}
        actions={{ roll, fork, star, shop, event, item, pick }}
      />
    </div>
  );
}

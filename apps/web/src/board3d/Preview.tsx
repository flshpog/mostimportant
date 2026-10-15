import { useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState } from "@everest/engine";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";
import { BoardHud } from "./BoardHud";

// #/preview: the 3D board with a few made-up players and no server, for checking the
// scene on any device without logging in.
export function Preview() {
  const layout = loadLayouts().main;
  const state = useMemo(() => {
    const ctx = { layout, rules: loadSeasonConfig() };
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
  }, [layout]);
  const animator = useRef(new TokenAnimator()).current;
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  const [followTurns, setFollowTurns] = useState(true);
  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={layout} state={state} meId="p1" avatars={{}} animator={animator} popups={[]} mode={mode} setMode={setMode} quality={window.location.hash.includes("lite") ? "lite" : "full"} />
      </div>
      <BoardHud
        boardName="Mario Stadium"
        boards={[{ id: "preview", name: "Mario Stadium" }]}
        boardId="preview"
        onBoard={() => undefined}
        status="live"
        state={state}
        layout={layout}
        season={loadSeasonConfig()}
        meId="p1"
        mode={mode}
        setMode={setMode}
        followTurns={followTurns}
        setFollowTurns={setFollowTurns}
        error={null}
        feed={[
          { seq: 3, text: "Toad landed on a blue space." },
          { seq: 2, text: "Toad got 3 coins. Now 13." },
          { seq: 1, text: "It's Peach's turn." },
        ]}
        actions={{ roll: () => undefined, fork: () => undefined, star: () => undefined, shop: () => undefined, event: () => undefined }}
      />
    </div>
  );
}

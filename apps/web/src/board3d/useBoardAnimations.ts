import { useCallback, useRef, useState } from "react";
import type { Board, SeasonConfig } from "@everest/board-data";
import type { BoardState } from "@everest/engine";
import type { CamMode } from "./Board3D";
import { spaceToWorld } from "./coords";
import { DICE_SPIN_MS, type DiceShow } from "./DiceRoll";
import type { Popup, TokenAnimator } from "./Tokens";

type AnyEvent = { type: string; [k: string]: unknown };

const HOP_MS = 340;
const DICE_HOLD_MS = DICE_SPIN_MS + 250;

// Turns engine events into animation: the dice first, then hops for moves, then
// pop-ups for coins and stars once the token has arrived. Shared by the live board
// and the offline preview.
export function useBoardAnimations(opts: {
  animator: TokenAnimator;
  season: SeasonConfig;
  followTurns: boolean;
  setMode: (m: CamMode) => void;
}) {
  const { animator, season, followTurns, setMode } = opts;
  const [popups, setPopups] = useState<Popup[]>([]);
  const [dice, setDice] = useState<DiceShow | null>(null);
  const nextId = useRef(0);

  const play = useCallback(
    (events: AnyEvent[], state: BoardState, layout: Board, meId: string | null) => {
      const add: Popup[] = [];
      const popup = (playerId: string, delta: number, icon: "coin" | "star") =>
        add.push({
          id: ++nextId.current,
          playerId,
          text: `${delta > 0 ? "+" : ""}${delta}`,
          icon,
          tone: delta < 0 ? "bad" : icon === "star" ? "star" : "good",
        });
      let rolled = false;
      for (const e of events) {
        if (e.type === "DiceRolled") {
          const id = e.playerId as string;
          rolled = true;
          animator.hold(id, DICE_HOLD_MS);
          setDice({
            key: ++nextId.current,
            playerId: id,
            name: state.players[id]?.name ?? "Someone",
            total: e.total as number,
            mine: id === meId,
            min: season.dice.min,
            max: season.dice.max,
          });
          if (followTurns) setMode({ kind: "follow", playerId: id });
        }
        if (e.type === "PlayerMoved") animator.enqueue(e.playerId as string, spaceToWorld(layout, e.to as string));
        if (e.type === "PlayerTeleported") {
          animator.queue.delete(e.playerId as string);
          animator.hop.delete(e.playerId as string);
          animator.shown.set(e.playerId as string, spaceToWorld(layout, e.to as string));
        }
        if (e.type === "PlayersSwapped") {
          // a single long hop each way, so the swap reads as a swap
          animator.enqueue(e.playerId as string, spaceToWorld(layout, e.playerTo as string));
          animator.enqueue(e.targetId as string, spaceToWorld(layout, e.targetTo as string));
        }
        if (e.type === "CoinsChanged" && e.reason !== "host" && e.delta !== 0) popup(e.playerId as string, e.delta as number, "coin");
        if (e.type === "StarsChanged" && e.reason !== "host" && e.delta !== 0) popup(e.playerId as string, e.delta as number, "star");
      }
      if (add.length) {
        const hops = events.filter((x) => x.type === "PlayerMoved").length;
        const delay = (rolled ? DICE_HOLD_MS : 0) + hops * HOP_MS;
        setTimeout(() => setPopups((p) => [...p, ...add]), delay);
        setTimeout(() => setPopups((p) => p.filter((x) => !add.includes(x))), delay + 1700 + add.length * 220);
      }
    },
    [animator, season, followTurns, setMode],
  );

  const clearDice = useCallback(() => setDice(null), []);
  return { play, popups, dice, clearDice };
}

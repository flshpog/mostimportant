import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, SeasonConfig } from "@everest/board-data";
import { EVENT_NAMES, type BoardState, type EventChoiceKind } from "@everest/engine";
import type { BannerShow } from "./Banner";
import type { CamMode } from "./Board3D";
import { spaceToWorld } from "./coords";
import { DICE_TOTAL_MS, type DiceShow } from "./DiceRoll";
import { STAR_CAMERA_AT, STAR_LANDED_AT, StarDirector } from "./Star";
import type { Popup, TokenAnimator } from "./Tokens";

type AnyEvent = { type: string; [k: string]: unknown };

const HOP_MS = 340;
const POPUP_MS = 1900;
// The mover waits until the star has landed and mostly slowed down.
const STAR_HOLD_MS = STAR_LANDED_AT + 700;

// Turns engine events into a little show: the dice, the hops, pop-ups and banners as
// the token gets there, and the star cutscene. Events arrive in batches (one action's
// worth), so `cursor` tracks when, from now, each event will be on screen.
// Shared by the live board and the offline preview.
export function useBoardAnimations(opts: {
  animator: TokenAnimator;
  season: SeasonConfig;
  followTurns: boolean;
  setMode: (m: CamMode) => void;
}) {
  const { animator, followTurns, setMode } = opts;
  const [popups, setPopups] = useState<Popup[]>([]);
  const [dice, setDice] = useState<DiceShow | null>(null);
  const [banner, setBanner] = useState<BannerShow | null>(null);
  const starDirector = useRef(new StarDirector()).current;
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);
  // When everything already scheduled will have played (performance.now()). The server
  // sends one action's events at a time (a roll, then the event draw that follows it),
  // so each batch starts where the last one ends instead of jumping ahead of the token.
  const endAt = useRef(0);
  // False while the token is still on its way: prompts wait for it to arrive.
  const [settled, setSettled] = useState(true);
  const settleToken = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, Math.max(0, ms)));
  }, []);

  const play = useCallback(
    (events: AnyEvent[], state: BoardState, layout: Board, meId: string | null) => {
      const name = (id: string) => state.players[id]?.name ?? "Someone";
      const who = (id: string, you: string, them: string) => (id === meId ? you : `${name(id)} ${them}`);
      const start = performance.now();
      let cursor = Math.max(0, endAt.current - start);
      let mover: string | null = null;
      const popup = (playerId: string, delta: number, icon: "coin" | "star") => {
        const p: Popup = {
          id: ++nextId.current,
          playerId,
          text: `${delta > 0 ? "+" : ""}${delta}`,
          icon,
          tone: delta < 0 ? "bad" : icon === "star" ? "star" : "good",
        };
        later(cursor, () => setPopups((ps) => [...ps, p]));
        later(cursor + POPUP_MS, () => setPopups((ps) => ps.filter((x) => x !== p)));
      };
      const showBanner = (at: number, b: Omit<BannerShow, "key">) => later(at, () => setBanner({ ...b, key: ++nextId.current }));

      for (const e of events) {
        const pid = e.playerId as string;
        switch (e.type) {
          case "DiceRolled":
            mover = pid;
            {
              const roll: DiceShow = { key: ++nextId.current, playerId: pid, name: name(pid), total: e.total as number, mine: pid === meId };
              later(cursor, () => {
                setDice(roll);
                if (followTurns) setMode({ kind: "follow", playerId: pid });
              });
            }
            animator.wait(pid, DICE_TOTAL_MS);
            cursor += DICE_TOTAL_MS;
            break;
          case "PlayerMoved":
            mover = pid;
            animator.enqueue(pid, spaceToWorld(layout, e.to as string));
            cursor += HOP_MS;
            break;
          case "PlayerTeleported":
            animator.clear(pid);
            animator.shown.set(pid, spaceToWorld(layout, e.to as string));
            break;
          case "PlayersSwapped":
            // a single long hop each way, so the swap reads as a swap
            animator.enqueue(pid, spaceToWorld(layout, e.playerTo as string));
            animator.enqueue(e.targetId as string, spaceToWorld(layout, e.targetTo as string));
            cursor += HOP_MS;
            showBanner(cursor, { tone: "event", text: who(pid, `You swapped places with ${name(e.targetId as string)}!`, `swapped places with ${name(e.targetId as string)}!`) });
            break;
          case "CoinsChanged":
            if (e.reason !== "host" && e.delta !== 0) popup(pid, e.delta as number, "coin");
            break;
          case "StarsChanged":
            if (e.reason !== "host" && e.delta !== 0) popup(pid, e.delta as number, "star");
            break;
          case "StarOffered":
            starDirector.raiseAt = performance.now() + cursor;
            break;
          case "StarPurchased": {
            const from = spaceToWorld(layout, e.spaceId as string);
            const start = cursor;
            later(start, () => {
              const to = starDirector.claim?.to ?? from;
              starDirector.claim = { start: performance.now(), from, to };
            });
            showBanner(start + 250, { tone: "star", text: who(pid, "You got a Star!", "got a Star!") });
            animator.wait(pid, STAR_HOLD_MS);
            mover = pid;
            break;
          }
          case "StarMoved":
            if (e.by === "purchase") {
              const to = spaceToWorld(layout, e.to as string);
              const start = cursor;
              later(start, () => {
                if (starDirector.claim) starDirector.claim.to = to;
              });
              const back = mover;
              later(start + STAR_CAMERA_AT, () => setMode({ kind: "star" }));
              later(start + STAR_LANDED_AT + 500, () => {
                if (followTurns && back) setMode({ kind: "follow", playerId: back });
              });
              cursor += STAR_HOLD_MS;
            }
            break;
          case "ForkChoiceRequired":
            if (pid === meId) showBanner(cursor, { tone: "info", text: "Fork in the road! Pick a path." });
            break;
          case "EventDrawn":
            showBanner(cursor, { tone: "event", text: `${EVENT_NAMES[e.event as EventChoiceKind]}!` });
            break;
          case "CoinsStolen":
            showBanner(cursor, {
              tone: "event",
              text: who(pid, `You stole ${e.amount} coins from ${name(e.targetId as string)}!`, `stole ${e.amount} coins from ${name(e.targetId as string)}!`),
            });
            break;
          case "StarStolen":
            showBanner(cursor, { tone: "star", text: who(pid, `You stole a Star from ${name(e.targetId as string)}!`, `stole a Star from ${name(e.targetId as string)}!`) });
            break;
        }
      }
      endAt.current = start + cursor;
      const token = ++settleToken.current;
      if (cursor > 0) {
        setSettled(false);
        later(cursor, () => token === settleToken.current && setSettled(true));
      }
    },
    [animator, followTurns, setMode, starDirector, later],
  );

  const clearDice = useCallback(() => setDice(null), []);
  const clearBanner = useCallback(() => setBanner(null), []);
  return { play, popups, dice, clearDice, banner, clearBanner, starDirector, settled };
}

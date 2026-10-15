import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, SeasonConfig } from "@everest/board-data";
import type { BoardState, EventChoiceKind } from "@everest/engine";
import type { BannerShow } from "./Banner";
import type { CamMode } from "./Board3D";
import { spaceToWorld } from "./coords";
import { DICE_TOTAL_MS, type DiceShow } from "./DiceRoll";
import { REVEAL_MS, WHEEL_MS, type RevealShow, type WheelShow } from "./EventOverlays";
import { COIN_FLIGHT_MS, FlightDirector, STAR_FLIGHT_MS } from "./Flights";
import { DROP, USE_MS } from "./ItemDrops";
import { ITEM_DICE_COLOURS } from "./ItemArt";
import { STAR_CAMERA_AT, STAR_LANDED_AT, StarDirector } from "./Star";
import type { Popup, TokenAnimator } from "./Tokens";

type AnyEvent = { type: string; [k: string]: unknown };

const HOP_MS = 340;
const POPUP_MS = 1900;
// The mover waits until the star has landed and mostly slowed down.
const STAR_HOLD_MS = STAR_LANDED_AT + 700;
// Event cutscenes: time for the camera to get somewhere, and for the swap flight.
const CAMERA_MS = 900;
const SWAP_FLY_MS = 2600;

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
  const { animator, season, followTurns, setMode } = opts;
  const [popups, setPopups] = useState<Popup[]>([]);
  const [dice, setDice] = useState<DiceShow | null>(null);
  const [banner, setBanner] = useState<BannerShow | null>(null);
  const starDirector = useRef(new StarDirector()).current;
  const flights = useRef(new FlightDirector()).current;
  const [reveal, setReveal] = useState<RevealShow | null>(null);
  const [wheel, setWheel] = useState<WheelShow | null>(null);
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
      const itemName = (id: string) => season.shop.items.find((i) => i.id === id)?.name ?? "an item";
      // "a Mushroom", "an Ice Flower"
      const an = (id: string) => {
        const n = itemName(id);
        return n === "an item" ? n : `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
      };
      const itemEffect = (id: string) => season.shop.items.find((i) => i.id === id)?.effect.kind;
      const who = (id: string, you: string, them: string) => (id === meId ? you : `${name(id)} ${them}`);
      const start = performance.now();
      let cursor = Math.max(0, endAt.current - start);
      let mover: string | null = null;
      const popup = (playerId: string, delta: number, icon: "coin" | "star", at = cursor) => {
        const p: Popup = {
          id: ++nextId.current,
          playerId,
          text: `${delta > 0 ? "+" : ""}${delta}`,
          icon,
          tone: delta < 0 ? "bad" : icon === "star" ? "star" : "good",
        };
        later(at, () => setPopups((ps) => [...ps, p]));
        later(at + POPUP_MS, () => setPopups((ps) => ps.filter((x) => x !== p)));
      };
      const showBanner = (at: number, b: Omit<BannerShow, "key">) => later(at, () => setBanner({ ...b, key: ++nextId.current }));
      const camera = (at: number, m: CamMode) => later(at, () => setMode(m));
      // after a cutscene, back to whoever's move it is (when following the action)
      const cameraBack = (at: number, id: string) => later(at, () => followTurns && setMode({ kind: "follow", playerId: id }));

      for (const e of events) {
        const pid = e.playerId as string;
        switch (e.type) {
          case "DiceRolled":
            mover = pid;
            // a Custom Dice Block rolls nothing: the die comes once a number is chosen
            if (e.choose) {
              if (pid === meId) showBanner(cursor, { tone: "info", text: "Choose a number" });
              break;
            }
            {
              const item = e.item as string | undefined;
              const roll: DiceShow = {
                key: ++nextId.current,
                playerId: pid,
                name: name(pid),
                total: e.total as number,
                mine: pid === meId,
                dice: e.dice as number[],
                colour: item ? ITEM_DICE_COLOURS[item] : undefined,
                choose: !!e.choose,
                halvedFrom: e.halvedFrom as number | undefined,
              };
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
          case "PlayersSwapped": {
            // pull back to the whole board; both pawns float up, cross, and come down
            const other = e.targetId as string;
            camera(cursor, { kind: "overview" });
            cursor += CAMERA_MS;
            animator.wait(pid, cursor);
            animator.wait(other, cursor);
            animator.fly(pid, spaceToWorld(layout, e.playerTo as string), SWAP_FLY_MS);
            animator.fly(other, spaceToWorld(layout, e.targetTo as string), SWAP_FLY_MS);
            cursor += SWAP_FLY_MS;
            showBanner(cursor, { tone: "event", text: who(pid, `You swapped places with ${name(other)}!`, `swapped places with ${name(other)}!`) });
            cameraBack(cursor + 400, pid);
            cursor += 1200;
            break;
          }
          case "CoinsChanged":
            // event and item coins get their own timing in the steal cutscenes, and
            // shop coins in the purchase one
            if (e.reason === "shop" && e.delta !== 0) popup(pid, e.delta as number, "coin", cursor + DROP.end - 500);
            else if (e.reason !== "host" && e.reason !== "event" && e.reason !== "item" && e.delta !== 0) popup(pid, e.delta as number, "coin");
            break;
          case "DiePicked":
            if (e.item) {
              // the block comes down on the chosen number
              const roll: DiceShow = {
                key: ++nextId.current,
                playerId: pid,
                name: name(pid),
                total: e.total as number,
                mine: pid === meId,
                dice: [e.value as number],
                colour: ITEM_DICE_COLOURS[e.item as string],
                choose: false,
                chosen: true,
                halvedFrom: e.halvedFrom as number | undefined,
              };
              later(cursor, () => {
                setDice(roll);
                if (followTurns) setMode({ kind: "follow", playerId: pid });
              });
              animator.wait(pid, DICE_TOTAL_MS);
              cursor += DICE_TOTAL_MS;
              break;
            }
            showBanner(cursor, {
              tone: "info",
              text:
                e.halvedFrom !== undefined
                  ? who(pid, `You picked ${e.value}, halved to ${e.total} by poison`, `picked ${e.value}, halved to ${e.total} by poison`)
                  : who(pid, `You picked ${e.value}!`, `picked ${e.value}!`),
            });
            cursor += 900;
            break;
          case "ItemUsed": {
            // it pops out of the pawn and bursts
            const item = an(e.itemId as string);
            const target = e.targetId as string | undefined;
            camera(cursor, { kind: "follow", playerId: pid });
            later(cursor, () => flights.items.add({ kind: "use", playerId: pid, model: e.itemId as string }));
            animator.wait(pid, USE_MS);
            showBanner(cursor + 500, {
              tone: "info",
              text: target ? who(pid, `You used ${item} on ${name(target)}`, `used ${item} on ${name(target)}`) : who(pid, `You used ${item}`, `used ${item}`),
            });
            cursor += USE_MS;
            break;
          }
          case "ShopPurchase":
          case "AdvantagePurchased": {
            // a beam from the sky, and the item drifts down it onto the buyer. Someone
            // else's purchase arrives as a wrapped present: bags are private.
            const advantage = e.type === "AdvantagePurchased";
            const adv = advantage ? season.shop.advantage?.perBoard[state.boardId] : undefined;
            const advantageName = adv?.name;
            const model = advantage ? `advantage:${adv?.image ?? ""}` : (e.itemId as string);
            camera(cursor, { kind: "follow", playerId: pid });
            later(cursor, () => flights.items.add({ kind: "buy", playerId: pid, model }));
            animator.wait(pid, DROP.end);
            const what = advantage ? (advantageName ?? "the tribe advantage") : e.itemId ? an(e.itemId as string) : "";
            showBanner(cursor + DROP.landed, {
              tone: advantage ? "star" : "info",
              text: pid === meId ? `You bought ${what}!` : `${name(pid)} bought something`,
            });
            cursor += DROP.end;
            break;
          }
          case "BooBellRang": {
            // the Boo goes over, and the coins fly back
            const target = e.targetId as string;
            const amount = e.amount as number;
            camera(cursor, { kind: "follow", playerId: target });
            cursor += CAMERA_MS;
            if (amount > 0) {
              popup(target, -amount, "coin");
              later(cursor + 250, () => flights.add({ kind: "coins", from: target, to: pid, count: Math.min(12, Math.max(3, amount)) }));
              camera(cursor + 450, { kind: "follow", playerId: pid });
              cursor += 250 + COIN_FLIGHT_MS;
              popup(pid, amount, "coin");
            } else cameraBack(cursor, pid);
            cursor += 800;
            break;
          }
          case "StealBlocked":
            camera(cursor, { kind: "follow", playerId: e.targetId as string });
            showBanner(cursor + 400, { tone: "info", text: `${name(e.targetId as string)}'s ${itemName("guard-charm")} blocked it` });
            cursor += 2200;
            cameraBack(cursor, pid);
            break;
          case "ItemSpent":
            if (itemEffect(e.itemId as string) === "starDiscount") showBanner(cursor, { tone: "star", text: who(pid, `Your ${itemName(e.itemId as string)} made the star cheaper`, `used ${an(e.itemId as string)} on the star`) });
            break;
          case "StarsChanged":
            if (e.reason !== "host" && e.reason !== "event" && e.delta !== 0) popup(pid, e.delta as number, "star");
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
            if (pid === meId) showBanner(cursor, { tone: "info", text: "Pick a path" });
            break;
          case "EventDrawn": {
            // the three events as cards, settling on the one that came up
            const show: RevealShow = { key: ++nextId.current, event: e.event as EventChoiceKind, name: name(pid), mine: pid === meId };
            later(cursor, () => setReveal(show));
            cursor += REVEAL_MS;
            break;
          }
          case "CoinsStolen": {
            const target = e.targetId as string;
            const amount = e.amount as number;
            // 1. the wheel picks the share
            const show: WheelShow = {
              key: ++nextId.current,
              percents: season.events.coinSteal.percents,
              percent: e.percent as number,
              thief: name(pid),
              target: name(target),
              mine: pid === meId,
            };
            later(cursor, () => setWheel(show));
            cursor += WHEEL_MS;
            // 2. over to the victim; the coins burst off them
            camera(cursor, { kind: "follow", playerId: target });
            cursor += CAMERA_MS;
            if (amount > 0) popup(target, -amount, "coin");
            // 3. they fly across, the camera rides back with them
            later(cursor + 250, () => flights.add({ kind: "coins", from: target, to: pid, count: Math.min(12, Math.max(3, amount)) }));
            camera(cursor + 450, { kind: "follow", playerId: pid });
            cursor += 250 + COIN_FLIGHT_MS;
            if (amount > 0) popup(pid, amount, "coin");
            showBanner(cursor, {
              tone: "event",
              text: amount
                ? who(pid, `You stole ${amount} coin${amount === 1 ? "" : "s"} from ${name(target)}!`, `stole ${amount} coin${amount === 1 ? "" : "s"} from ${name(target)}!`)
                : `${name(target)} had nothing to steal!`,
            });
            cursor += 1200;
            break;
          }
          case "StarStolen": {
            const target = e.targetId as string;
            // the thief pays, then over to the victim; their star lifts off and flies over
            popup(pid, -(e.price as number), "coin");
            camera(cursor + 600, { kind: "follow", playerId: target });
            cursor += 600 + CAMERA_MS;
            popup(target, -1, "star");
            later(cursor, () => flights.add({ kind: "star", from: target, to: pid, count: 1 }));
            camera(cursor + 700, { kind: "follow", playerId: pid });
            cursor += STAR_FLIGHT_MS;
            popup(pid, 1, "star");
            showBanner(cursor, { tone: "star", text: who(pid, `You stole a Star from ${name(target)}!`, `stole a Star from ${name(target)}!`) });
            cursor += 1200;
            break;
          }
        }
      }
      endAt.current = start + cursor;
      const token = ++settleToken.current;
      if (cursor > 0) {
        setSettled(false);
        later(cursor, () => token === settleToken.current && setSettled(true));
      }
    },
    [animator, season, followTurns, setMode, starDirector, flights, later],
  );

  const clearDice = useCallback(() => setDice(null), []);
  const clearBanner = useCallback(() => setBanner(null), []);
  // What the panel and feed show: the live value once everything has played, and the
  // last settled value while a cutscene is still running, so standings and the feed
  // don't give away a result (where you land, what the wheel picks) before it happens.
  const frozen = useRef<Record<string, unknown>>({});
  const hold = <T,>(key: string, live: T): T => {
    if (settled) {
      frozen.current[key] = live;
      return live;
    }
    return key in frozen.current ? (frozen.current[key] as T) : live;
  };
  const clearReveal = useCallback(() => setReveal(null), []);
  const clearWheel = useCallback(() => setWheel(null), []);
  return { play, popups, dice, clearDice, banner, clearBanner, starDirector, flights, settled, reveal, clearReveal, wheel, clearWheel, hold };
}

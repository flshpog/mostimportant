import { useEffect, useRef, useState } from "react";
import type { Board, SeasonConfig } from "@everest/board-data";
import { currentPlayerId, type BoardState } from "@everest/engine";
import type { LiveStatus } from "../lib/useLiveBoard";
import type { CamMode } from "./Board3D";
import { directionOf, FORK_COLOURS } from "./coords";
import { ArrowIcon, BangIcon, CoinIcon, DiceIcon, ShopIcon, FollowIcon, MapIcon, OutlineStarIcon, PinIcon, StarIcon } from "./Icons";
import { tokenColour } from "./Tokens";

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export interface HudActions {
  roll(): void;
  fork(next: string): void;
  star(buy: boolean): void;
  shop(itemId: string | null): void;
  event(targetId: string | null): void;
}

// Everything drawn over the 3D board. On wide screens: title top-left, a side panel
// on the right, the feed bottom-left and camera buttons bottom-centre. On phones:
// a slim title bar, icon camera buttons and a bottom sheet that always shows the turn
// and your buttons, with standings one tap away.
export function BoardHud(props: {
  boardName: string;
  boards: { id: string; name: string }[];
  boardId: string;
  onBoard: (id: string) => void;
  status: LiveStatus;
  state: BoardState;
  layout: Board;
  season: SeasonConfig;
  meId: string;
  mode: CamMode;
  setMode: (m: CamMode) => void;
  followTurns: boolean;
  setFollowTurns: (v: boolean) => void;
  error: string | null;
  feed: { seq: number; text: string }[];
  actions: HudActions;
  // False while tokens are still moving: prompts wait until the player has arrived.
  ready: boolean;
}) {
  const { state, layout, season, meId, mode, setMode, actions } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const current = currentPlayerId(state);
  const myTurn = state.started && current === meId;
  const choice = state.move?.playerId === meId ? state.move.choice : null;
  const players = Object.values(state.players).sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
  const nameOf = (id: string) => state.players[id]?.name ?? "someone";
  const itemName = (id: string) => season.shop.items.find((i) => i.id === id)?.name ?? id;
  const opens = state.turn.windowOpensAt;
  const me = state.players[meId];
  const waiting = !state.move && opens !== null && opens > Date.now();
  // Nothing else re-renders the HUD when a cooldown runs out, so wake up when it does
  // (otherwise Roll stays greyed out until some unrelated update).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!waiting || opens === null) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(opens - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [waiting, opens]);

  const turnLine = !state.started ? (
    <span className="turn-text">The board hasn't started yet.</span>
  ) : state.paused ? (
    <span className="turn-text">Paused by the hosts.</span>
  ) : current ? (
    <>
      <span className="dot" style={{ background: tokenColour(current) }} />
      <span className="turn-text">
        {myTurn ? <b>Your turn!</b> : <><b>{nameOf(current)}</b>'s turn</>}
        {waiting && <span className="when">Opens {NY.format(opens!)}</span>}
      </span>
    </>
  ) : null;

  // The action dock: one big, loud card at the bottom centre for whatever you have to
  // do right now. It waits until your token has actually arrived (`ready`).
  const card = (kind: string, icon: React.ReactNode, title: React.ReactNode, sub: React.ReactNode, body: React.ReactNode) => (
    <div className={`dock-card ${kind}`} key={`${kind}-${state.move?.rolledAt ?? opens}-${state.move?.remaining ?? ""}`}>
      <div className="dock-head">
        {icon}
        <span className="dock-title">{title}</span>
      </div>
      <div className="dock-body">
        {sub && <div className="dock-sub">{sub}</div>}
        {props.error && <p className="dock-error">{props.error}</p>}
        <div className="dock-buttons">{body}</div>
      </div>
    </div>
  );

  let dock: React.ReactNode = null;
  if (props.ready && myTurn && !state.move && !waiting && !state.paused) {
    dock = card(
      "roll",
      <DiceIcon />,
      "Your turn!",
      null,
      <button className="dock-button go big" onClick={actions.roll}>
        <DiceIcon /> Roll
      </button>,
    );
  } else if (props.ready && choice?.kind === "fork") {
    dock = card(
      "fork",
      <ArrowIcon deg={90} />,
      "Fork in the road!",
      <>Pick a path · tap an arrow on the board or here · {state.move!.remaining} to go</>,
      choice.options.map((o, i) => {
        const d = directionOf(layout, choice.spaceId, o);
        return (
          <button key={o} className="dock-button path" style={{ ["--path" as string]: FORK_COLOURS[i % FORK_COLOURS.length] }} onClick={() => actions.fork(o)}>
            <ArrowIcon deg={d.deg} /> {d.word}
          </button>
        );
      }),
    );
  } else if (props.ready && choice?.kind === "star") {
    dock = card(
      "star",
      <StarIcon />,
      "You reached the Star!",
      <>You have {me?.coins ?? 0} coins</>,
      <>
        <button className="dock-button gold big" onClick={() => actions.star(true)}>
          Buy for {choice.price} <CoinIcon />
        </button>
        <button className="dock-button quiet" onClick={() => actions.star(false)}>
          No thanks
        </button>
      </>,
    );
  } else if (props.ready && choice?.kind === "shop") {
    dock = card(
      "shop",
      <ShopIcon />,
      "Welcome to the Shop!",
      <>You have {me?.coins ?? 0} coins</>,
      <>
        {season.shop.items
          .filter((i) => i.price <= (me?.coins ?? 0))
          .map((i) => (
            <button key={i.id} className="dock-button shopitem" onClick={() => actions.shop(i.id)}>
              {i.name} <span className="price">{i.price} <CoinIcon /></span>
            </button>
          ))}
        <button className="dock-button quiet" onClick={() => actions.shop(null)}>
          Leave
        </button>
      </>,
    );
  } else if (props.ready && (choice?.kind === "coinSteal" || choice?.kind === "starSteal" || choice?.kind === "swap")) {
    const targets = choice.targets.filter((id) => state.players[id]);
    dock = card(
      "event",
      <BangIcon />,
      choice.kind === "coinSteal" ? "Coin Steal!" : choice.kind === "starSteal" ? "Star Steal!" : "Swap Places!",
      choice.kind === "coinSteal" ? (
        <>Pick a tribemate. You'll take a random 5-50% of their coins!</>
      ) : choice.kind === "starSteal" ? (
        <>Pay {choice.price} coins to take a star from someone?</>
      ) : (
        <>Pick someone to trade spots with</>
      ),
      <>
        {targets.map((id) => {
          const t = state.players[id];
          return (
            <button key={id} className="dock-button target" onClick={() => actions.event(id)}>
              <span className="dot" style={{ background: tokenColour(id) }} />
              {t.name}
              {choice.kind === "coinSteal" && <span className="price">{t.coins} <CoinIcon /></span>}
              {choice.kind === "starSteal" && <span className="price">{t.stars} <StarIcon /></span>}
            </button>
          );
        })}
        {choice.kind !== "coinSteal" && (
          <button className="dock-button quiet" onClick={() => actions.event(null)}>
            No thanks
          </button>
        )}
      </>,
    );
  }

  // On phones the dock sits just above the bottom sheet, whatever its height.
  const sheet = useRef<HTMLElement>(null);
  const [sheetH, setSheetH] = useState(0);
  useEffect(() => {
    const el = sheet.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const standings = (
    <ol className="standings">
      {players.map((p, i) => (
        <li key={p.id} className={`${p.id === meId ? "me" : ""} ${p.id === current && state.started ? "up" : ""}`}>
          <button className="link-row" onClick={() => setMode({ kind: "follow", playerId: p.id })}>
            <span className="rank">{i + 1}</span>
            <span className="dot" style={{ background: tokenColour(p.id) }} />
            <span className="name">{p.name}</span>
            <span className="stat">
              {p.stars} <StarIcon />
            </span>
            <span className="stat coins">
              {p.coins} <CoinIcon />
            </span>
          </button>
          {p.items.length > 0 && <div className="items">{p.items.map(itemName).join(", ")}</div>}
        </li>
      ))}
    </ol>
  );

  const following = mode.kind === "follow" ? mode.playerId : null;
  return (
    <>
      <header className="hud-top">
        <div className="hud-title glass">
          <h1>{props.boardName}</h1>
          <span className={`live-dot ${props.status}`} title={`live: ${props.status}`} />
        </div>
        {props.boards.length > 1 && (
          <select className="glass" value={props.boardId} onChange={(e) => props.onBoard(e.target.value)} aria-label="Board">
            {props.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav className="hud-cams glass" aria-label="Camera">
        <button className={mode.kind === "overview" ? "active" : ""} onClick={() => setMode({ kind: "overview" })} title="Whole board">
          <MapIcon />
          <span className="label">Overview</span>
        </button>
        {me && (
          <button className={following === meId ? "active" : ""} onClick={() => setMode({ kind: "follow", playerId: meId })} title="Follow me">
            <PinIcon />
            <span className="label">Me</span>
          </button>
        )}
        {state.star && (
          <button className={mode.kind === "star" ? "active" : ""} onClick={() => setMode({ kind: "star" })} title="Go to the star">
            <OutlineStarIcon />
            <span className="label">Star</span>
          </button>
        )}
        <select
          className={following && following !== meId ? "active" : ""}
          value={following && following !== meId ? following : ""}
          onChange={(e) => e.target.value && setMode({ kind: "follow", playerId: e.target.value })}
          aria-label="Follow a player"
        >
          <option value="">Follow…</option>
          {players
            .filter((p) => p.id !== meId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <span className="sep" />
        <button className={`auto ${props.followTurns ? "on" : ""}`} onClick={() => props.setFollowTurns(!props.followTurns)} title="Fly to whoever is moving">
          <FollowIcon />
          <span className="label">Auto camera</span>
          <span className="switch" />
        </button>
      </nav>

      {dock && (
        <div className="action-dock" style={{ ["--sheet-h" as string]: `${sheetH}px` }}>
          {dock}
        </div>
      )}

      <aside ref={sheet} className={`hud-panel glass ${sheetOpen ? "open" : ""}`}>
        <button className="sheet-handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
          <span className="grip" />
          <span>{sheetOpen ? "Hide standings" : "Standings"}</span>
        </button>
        <section className={`turn ${myTurn ? "mine" : ""}`}>
          <div className="turn-line">{turnLine}</div>
          {me && (
            <div className="my-stats">
              <span>
                <StarIcon /> {me.stars}
              </span>
              <span>
                <CoinIcon /> {me.coins}
              </span>
            </div>
          )}
          {props.error && !dock && <p className="error-text">{props.error}</p>}
        </section>
        <section className="standings-section">
          <h2>Standings</h2>
          {standings}
        </section>
      </aside>

      {props.feed.length > 0 && (
        <ol className="hud-feed" aria-live="polite">
          {props.feed.map((l) => (
            <li key={l.seq + l.text}>{l.text}</li>
          ))}
        </ol>
      )}
    </>
  );
}

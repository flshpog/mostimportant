import { useState } from "react";
import type { Board, SeasonConfig } from "@everest/board-data";
import { currentPlayerId, type BoardState } from "@everest/engine";
import type { LiveStatus } from "../lib/useLiveBoard";
import type { CamMode } from "./Board3D";
import { directionLabel } from "./coords";
import { tokenColour } from "./Tokens";

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export interface HudActions {
  roll(): void;
  fork(next: string): void;
  star(buy: boolean): void;
  shop(itemId: string | null): void;
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

  const turnLine = !state.started ? (
    <>The board hasn't started yet.</>
  ) : state.paused ? (
    <>⏸️ Paused by the hosts.</>
  ) : current ? (
    <>
      {myTurn ? <b>Your turn!</b> : <><b>{nameOf(current)}</b>'s turn</>}
      {!state.move && opens !== null && opens > Date.now() && <span className="muted"> · opens {NY.format(opens)}</span>}
    </>
  ) : null;

  const buttons = (
    <>
      {myTurn && !state.move && (
        <button className="button primary big" onClick={actions.roll}>
          🎲 Roll
        </button>
      )}
      {choice?.kind === "fork" && (
        <div className="row">
          {choice.options.map((o) => (
            <button key={o} className="button" onClick={() => actions.fork(o)}>
              {directionLabel(layout, choice.spaceId, o)}
            </button>
          ))}
        </div>
      )}
      {choice?.kind === "star" && (
        <div className="row">
          <button className="button primary" onClick={() => actions.star(true)}>
            ⭐ Buy ({choice.price})
          </button>
          <button className="button" onClick={() => actions.star(false)}>
            No thanks
          </button>
        </div>
      )}
      {choice?.kind === "shop" && (
        <div className="row">
          {season.shop.items
            .filter((i) => i.price <= (me?.coins ?? 0))
            .map((i) => (
              <button key={i.id} className="button" onClick={() => actions.shop(i.id)}>
                {i.name} ({i.price})
              </button>
            ))}
          <button className="button" onClick={() => actions.shop(null)}>
            Leave
          </button>
        </div>
      )}
    </>
  );

  const standings = (
    <ol className="standings">
      {players.map((p) => (
        <li key={p.id} className={p.id === meId ? "me" : ""}>
          <button className="link-row" onClick={() => setMode({ kind: "follow", playerId: p.id })}>
            <span className="dot" style={{ background: tokenColour(p.id) }} />
            <span className="name">{p.name}</span>
            <span className="stat">⭐ {p.stars}</span>
            <span className="stat">🪙 {p.coins}</span>
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
        <div className="hud-title">
          <h1>{props.boardName}</h1>
          <span className={`live-dot ${props.status}`} title={`live: ${props.status}`} />
        </div>
        {props.boards.length > 1 && (
          <select value={props.boardId} onChange={(e) => props.onBoard(e.target.value)} aria-label="Board">
            {props.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav className="hud-cams" aria-label="Camera">
        <button className={mode.kind === "overview" ? "active" : ""} onClick={() => setMode({ kind: "overview" })} title="Whole board">
          🗺️<span className="label"> Overview</span>
        </button>
        {me && (
          <button className={following === meId ? "active" : ""} onClick={() => setMode({ kind: "follow", playerId: meId })} title="Follow me">
            📍<span className="label"> Me</span>
          </button>
        )}
        <select value={following && following !== meId ? following : ""} onChange={(e) => e.target.value && setMode({ kind: "follow", playerId: e.target.value })} aria-label="Follow a player">
          <option value="">👥 Follow...</option>
          {players
            .filter((p) => p.id !== meId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        {state.star && (
          <button className={mode.kind === "star" ? "active" : ""} onClick={() => setMode({ kind: "star" })} title="Go to the star">
            ⭐<span className="label"> Star</span>
          </button>
        )}
        <button className={`auto ${props.followTurns ? "active" : ""}`} onClick={() => props.setFollowTurns(!props.followTurns)} title="Fly to whoever is moving">
          🎬<span className="label"> {props.followTurns ? "Following the action" : "Follow the action"}</span>
        </button>
      </nav>

      <aside className={`hud-panel ${sheetOpen ? "open" : ""}`}>
        <button className="sheet-handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
          <span className="grip" />
          <span>{sheetOpen ? "Hide standings" : "Standings"}</span>
        </button>
        <section className="turn">
          <p>{turnLine}</p>
          {props.error && <p className="error-text">{props.error}</p>}
          {buttons}
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { currentPlayerId, describeEvent } from "@everest/engine";
import { ApiError, api, getToken, setToken, loginUrl, API_BASE } from "../lib/api";
import { useLiveBoard, type FeedEvent } from "../lib/useLiveBoard";
import { Board3D, type CamMode } from "./Board3D";
import { directionLabel, spaceToWorld } from "./coords";
import { TokenAnimator, tokenColour, type Popup } from "./Tokens";

interface Me {
  user: { id: string; name: string; avatar: string | null };
  boardId: string | null;
  isHost: boolean;
}
interface Summary {
  id: string;
  name: string;
}
interface Health {
  discordLogin: boolean;
  devLogins: { id: string; name: string }[];
}

const layouts = loadLayouts();
const season = loadSeasonConfig();
const itemName = (id: string) => season.shop.items.find((i) => i.id === id)?.name ?? id;
const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function Login({ message }: { message: string | null }) {
  const [health, setHealth] = useState<Health | "down" | null>(null);
  useEffect(() => {
    api<Health>("/api/health").then(setHealth, () => setHealth("down"));
  }, []);
  return (
    <div className="board-login">
      <h1>Everest board</h1>
      {message && <p className="error-text">{message}</p>}
      {health === "down" && <p className="muted">Can't reach the board server right now.</p>}
      {health && health !== "down" && (
        <>
          {health.discordLogin && (
            <a className="button primary big" href={loginUrl()}>
              Log in with Discord
            </a>
          )}
          {health.devLogins.length > 0 && (
            <div className="row center">
              {health.devLogins.map((u) => (
                <a key={u.id} className="button" href={`${API_BASE}/dev/login/${u.id}`}>
                  Log in as {u.name}
                </a>
              ))}
            </div>
          )}
          {!health.discordLogin && !health.devLogins.length && <p className="muted">Login isn't set up on this server yet.</p>}
        </>
      )}
    </div>
  );
}

export function BoardPage() {
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [boards, setBoards] = useState<Summary[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  const [popups, setPopups] = useState<Popup[]>([]);
  const [followTurns, setFollowTurns] = useState(true);
  const animator = useRef(new TokenAnimator()).current;
  const popupId = useRef(0);
  const stateRef = useRef<ReturnType<typeof useLiveBoard>["state"]>(null);

  useEffect(() => {
    if (!token) return;
    api<Me>("/api/me")
      .then(async (m) => {
        setMe(m);
        const b = await api<{ boards: Summary[] }>("/api/boards");
        setBoards(b.boards);
        setBoardId((cur) => cur ?? m.boardId ?? b.boards[0]?.id ?? null);
      })
      .catch((e: ApiError) => {
        if (e.status === 401) {
          setToken(null);
          setTok(null);
          setError("That login didn't work or has expired. Log in again.");
        } else setError(e.message);
      });
  }, [token]);

  const layout = useCallback((layoutId: string) => layouts[layoutId], []);

  // Live events drive the animation: hops for moves, pop-ups for coins and stars.
  const onLive = useCallback(
    (events: FeedEvent[]) => {
      const s = stateRef.current;
      const lay = s ? layouts[s.layoutId] : null;
      if (!lay) return;
      const add: Popup[] = [];
      for (const { event: e } of events) {
        if (e.type === "PlayerMoved") animator.enqueue(e.playerId as string, spaceToWorld(lay, e.to as string));
        if (e.type === "PlayerTeleported") {
          animator.queue.delete(e.playerId as string);
          animator.hop.delete(e.playerId as string);
          animator.shown.set(e.playerId as string, spaceToWorld(lay, e.to as string));
        }
        if (e.type === "CoinsChanged" && e.reason !== "host" && e.delta !== 0) {
          const d = e.delta as number;
          add.push({ id: ++popupId.current, playerId: e.playerId as string, text: `${d > 0 ? "+" : ""}${d} 🪙`, tone: d > 0 ? "good" : "bad" });
        }
        if (e.type === "StarPurchased") add.push({ id: ++popupId.current, playerId: e.playerId as string, text: "+1 ⭐", tone: "star" });
        if (e.type === "DiceRolled" && followTurns) setMode({ kind: "follow", playerId: e.playerId as string });
      }
      if (add.length) {
        // let the hops land before the pop-up shows
        const delay = events.filter((x) => x.event.type === "PlayerMoved").length * 340;
        setTimeout(() => setPopups((p) => [...p, ...add]), delay);
        setTimeout(() => setPopups((p) => p.filter((x) => !add.includes(x))), delay + 1600);
      }
    },
    [animator, followTurns],
  );

  const { state, feed, status } = useLiveBoard(token, boardId, onLive);
  stateRef.current = state;

  // Everyone's Discord avatar for the pawn tags, refreshed when the player list changes.
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const playerKey = state ? state.turn.order.join(",") : "";
  useEffect(() => {
    if (!boardId || !playerKey) return;
    api<{ profiles: Record<string, { avatar: string | null }> }>(`/api/boards/${boardId}/profiles`)
      .then((r) => setAvatars(Object.fromEntries(Object.entries(r.profiles).map(([id, p]) => [id, p.avatar]))))
      .catch(() => undefined);
  }, [boardId, playerKey]);

  // A fresh board view snaps tokens into place instead of animating history.
  useEffect(() => {
    animator.shown.clear();
    animator.queue.clear();
    animator.hop.clear();
  }, [boardId, animator]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  if (!token || !me) return <Login message={error} />;
  const lay = state ? layout(state.layoutId) : null;
  if (!boardId) return <Login message="You aren't on a board yet. A host needs to add you." />;
  if (!state || !lay) return <div className="board-loading">Loading the board...</div>;

  const current = currentPlayerId(state);
  const myTurn = state.started && current === me.user.id;
  const choice = state.move?.playerId === me.user.id ? state.move.choice : null;
  const players = Object.values(state.players).sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
  const nameOf = (id: string) => state.players[id]?.name ?? "someone";
  const opens = state.turn.windowOpensAt;
  const boardName = boards.find((b) => b.id === boardId)?.name ?? boardId;
  const lines = feed
    .map((e) => ({ seq: e.seq, text: describeEvent(e.event as never, nameOf, itemName) }))
    .filter((l): l is { seq: number; text: string } => !!l.text)
    .slice(0, 6);

  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={lay} state={state} meId={me.user.id} avatars={{ ...avatars, [me.user.id]: me.user.avatar }} animator={animator} popups={popups} mode={mode} setMode={setMode} />
      </div>

      <header className="hud-top">
        <div className="hud-title">
          <h1>{boardName}</h1>
          <span className={`live-dot ${status}`} title={`live: ${status}`} />
        </div>
        {boards.length > 1 && (
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} aria-label="Board">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav className="hud-cams" aria-label="Camera">
        <button className={mode.kind === "overview" ? "active" : ""} onClick={() => setMode({ kind: "overview" })}>
          🗺️ Overview
        </button>
        {state.players[me.user.id] && (
          <button className={mode.kind === "follow" && mode.playerId === me.user.id ? "active" : ""} onClick={() => setMode({ kind: "follow", playerId: me.user.id })}>
            📍 Me
          </button>
        )}
        <select
          value={mode.kind === "follow" && mode.playerId !== me.user.id ? mode.playerId : ""}
          onChange={(e) => e.target.value && setMode({ kind: "follow", playerId: e.target.value })}
          aria-label="Follow a player"
        >
          <option value="">👥 Follow...</option>
          {players
            .filter((p) => p.id !== me.user.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        {state.star && (
          <button className={mode.kind === "star" ? "active" : ""} onClick={() => setMode({ kind: "star" })}>
            ⭐ Star
          </button>
        )}
        <label className="hud-toggle">
          <input type="checkbox" checked={followTurns} onChange={(e) => setFollowTurns(e.target.checked)} /> follow the action
        </label>
      </nav>

      <aside className="hud-panel">
        <section>
          {!state.started ? (
            <p>The board hasn't started yet.</p>
          ) : state.paused ? (
            <p>⏸️ Paused by the hosts.</p>
          ) : current ? (
            <p>
              {myTurn ? <b>Your turn!</b> : <><b>{nameOf(current)}</b>'s turn</>}
              {!state.move && opens !== null && opens > Date.now() && <span className="muted"> · opens {NY.format(opens)}</span>}
            </p>
          ) : null}
          {error && <p className="error-text">{error}</p>}
          {myTurn && !state.move && (
            <button className="button primary big" onClick={() => run(() => api("/api/play/roll", { body: {} }))}>
              🎲 Roll
            </button>
          )}
          {choice?.kind === "fork" && (
            <div className="row">
              {choice.options.map((o) => (
                <button key={o} className="button" onClick={() => run(() => api("/api/play/fork", { body: { next: o } }))}>
                  {directionLabel(lay, choice.spaceId, o)}
                </button>
              ))}
            </div>
          )}
          {choice?.kind === "star" && (
            <div className="row">
              <button className="button primary" onClick={() => run(() => api("/api/play/star", { body: { buy: true } }))}>
                ⭐ Buy ({choice.price})
              </button>
              <button className="button" onClick={() => run(() => api("/api/play/star", { body: { buy: false } }))}>
                No thanks
              </button>
            </div>
          )}
          {choice?.kind === "shop" && (
            <div className="row">
              {season.shop.items
                .filter((i) => i.price <= (state.players[me.user.id]?.coins ?? 0))
                .map((i) => (
                  <button key={i.id} className="button" onClick={() => run(() => api("/api/play/shop", { body: { itemId: i.id } }))}>
                    {i.name} ({i.price})
                  </button>
                ))}
              <button className="button" onClick={() => run(() => api("/api/play/shop", { body: {} }))}>
                Leave
              </button>
            </div>
          )}
        </section>
        <section>
          <h2>Standings</h2>
          <ol className="standings">
            {players.map((p) => (
              <li key={p.id} className={p.id === me.user.id ? "me" : ""}>
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
        </section>
      </aside>

      {lines.length > 0 && (
        <ol className="hud-feed" aria-live="polite">
          {lines.map((l) => (
            <li key={l.seq + l.text}>{l.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

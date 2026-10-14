import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { loadSeasonConfig } from "@everest/board-data";
import { currentPlayerId, describeEvent } from "@everest/engine";
import { API_BASE, ApiError, api, getToken, loginUrl, setToken } from "../lib/api";
import { useLiveBoard } from "../lib/useLiveBoard";

// A plain test console for the board server: log in, watch a board live, play,
// and run host tools. The real board UI replaces this in phases 6-7.

interface Me {
  user: { id: string; name: string; avatar: string | null };
  boardId: string | null;
  isHost: boolean;
}
interface Summary {
  id: string;
  name: string;
  players: number;
  started: boolean;
  paused: boolean;
}

const season = loadSeasonConfig();
const itemName = (id: string) => season.shop.items.find((i) => i.id === id)?.name ?? id;
const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const when = (ms: number | null) => (ms === null ? "no limit" : NY.format(ms));

export function TestConsole() {
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [boards, setBoards] = useState<Summary[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [health, setHealth] = useState<"checking" | "up" | "down">("checking");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const { state, feed, status } = useLiveBoard(token, boardId);

  useEffect(() => {
    api("/api/health").then(() => setHealth("up"), () => setHealth("down"));
  }, []);

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
        }
        setMessage({ kind: "error", text: e.message });
      });
  }, [token]);

  // Runs an API call and reports the result in plain language.
  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: "ok", text: `${label}: done.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    }
  }, []);

  const name = (id: string) => state?.players[id]?.name ?? (id === me?.user.id ? me.user.name : id);

  if (!token || !me) {
    return (
      <div className="console">
        <h1>Board test console</h1>
        <p className="muted">
          Server <span className="mono">{API_BASE}</span>: {health === "up" ? "reachable" : health === "down" ? "not reachable" : "checking..."}
        </p>
        {message && <p className={message.kind === "error" ? "error-text" : "ok"}>{message.text}</p>}
        <a className="button primary" href={loginUrl()}>
          Log in with Discord
        </a>
      </div>
    );
  }

  const myTurn = state && currentPlayerId(state) === me.user.id;
  const choice = state?.move?.playerId === me.user.id ? state.move.choice : null;
  const players = state ? Object.values(state.players).sort((a, b) => b.stars - a.stars || b.coins - a.coins) : [];

  return (
    <div className="console">
      <header className="console-header">
        <div>
          <h1>Board test console</h1>
          <p className="muted">
            {me.user.name} {me.isHost && <span className="badge">host</span>} · live: {status}
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setToken(null);
            setTok(null);
            setMe(null);
          }}
        >
          Log out
        </button>
      </header>

      {message && <p className={message.kind === "error" ? "error-text" : "ok"}>{message.text}</p>}

      {boards.length > 1 && (
        <nav className="tabs">
          {boards.map((b) => (
            <button key={b.id} className={`tab ${b.id === boardId ? "active" : ""}`} onClick={() => setBoardId(b.id)}>
              {b.name} ({b.players})
            </button>
          ))}
        </nav>
      )}
      {!boardId && <p className="muted">You aren't on a board yet. A host needs to add you.</p>}

      {state && (
        <div className="console-grid">
          <Card title="Turn">
            {!state.started ? (
              <p>Not started.</p>
            ) : (
              <>
                <p>
                  {state.paused && <span className="badge">paused</span>} Current: <b>{name(currentPlayerId(state) ?? "")}</b>
                </p>
                <p className="muted">
                  Window opens {when(state.turn.windowOpensAt)} · closes {when(state.turn.deadline)}
                </p>
                <p className="muted">Star: {state.star ?? "none"}</p>
                {state.move?.choice && state.move.playerId !== me.user.id && (
                  <p className="muted">
                    Waiting for {name(state.move.playerId)}: {state.move.choice.kind} at {state.move.choice.spaceId}
                    {"expiresAt" in state.move.choice && ` (default ${when(state.move.choice.expiresAt)})`}
                  </p>
                )}
              </>
            )}
            {myTurn && !state.move && (
              <button className="button primary" onClick={() => run("Roll", () => api("/api/play/roll", { body: {} }))}>
                Roll
              </button>
            )}
            {choice?.kind === "fork" && (
              <div className="row">
                <span>Fork at {choice.spaceId}:</span>
                {choice.options.map((o) => (
                  <button key={o} className="button" onClick={() => run("Fork", () => api("/api/play/fork", { body: { next: o } }))}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            {choice?.kind === "star" && (
              <div className="row">
                <span>Buy the star for {choice.price}?</span>
                <button className="button primary" onClick={() => run("Star", () => api("/api/play/star", { body: { buy: true } }))}>
                  Buy
                </button>
                <button className="button" onClick={() => run("Star", () => api("/api/play/star", { body: { buy: false } }))}>
                  Skip
                </button>
              </div>
            )}
            {choice?.kind === "shop" && (
              <div className="row">
                <span>Shop:</span>
                {season.shop.items.map((i) => (
                  <button key={i.id} className="button" onClick={() => run("Shop", () => api("/api/play/shop", { body: { itemId: i.id } }))}>
                    {i.name} ({i.price})
                  </button>
                ))}
                <button className="button" onClick={() => run("Shop", () => api("/api/play/shop", { body: {} }))}>
                  Leave
                </button>
              </div>
            )}
          </Card>

          <Card title="Players">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Space</th>
                  <th>Stars</th>
                  <th>Coins</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <div className="mono muted small">{p.id}</div>
                    </td>
                    <td className="mono">{p.space}</td>
                    <td>{p.stars}</td>
                    <td>{p.coins}</td>
                    <td>{p.items.map(itemName).join(", ") || "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {me.isHost && boardId && <HostTools boardId={boardId} boards={boards} players={players.map((p) => ({ id: p.id, name: p.name }))} started={state.started} paused={state.paused} run={run} />}

          <Card title="Live feed">
            <ol className="feed">
              {feed.map((e) => {
                const text = describeEvent(e.event as never, name, itemName);
                return text ? (
                  <li key={`${e.seq}-${e.event.type}`}>
                    <span className="mono muted small">#{e.seq}</span> {text}
                  </li>
                ) : null;
              })}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}

function HostTools(props: {
  boardId: string;
  boards: Summary[];
  players: { id: string; name: string }[];
  started: boolean;
  paused: boolean;
  run: (label: string, fn: () => Promise<unknown>) => void;
}) {
  const { boardId, boards, players, started, paused, run } = props;
  const action = (label: string, a: object) => run(label, () => api(`/api/host/boards/${boardId}/actions`, { body: { action: a } }));
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState("");
  const [coins, setCoins] = useState("10");
  const [dest, setDest] = useState("");
  const [reset, setReset] = useState(false);
  const [starSpace, setStarSpace] = useState("");
  const pid = target || players[0]?.id || "";

  const add = (e: FormEvent) => {
    e.preventDefault();
    run("Add player", () => api("/api/host/transfer", { body: { playerId: newId.trim(), to: boardId, name: newName.trim() || newId.trim() } }));
  };

  return (
    <Card title="Host tools">
      <div className="row">
        {!started && (
          <button className="button primary" onClick={() => action("Start", { type: "startBoard" })}>
            Start board
          </button>
        )}
        {started && (
          <button className="button" onClick={() => action(paused ? "Resume" : "Pause", { type: paused ? "resume" : "pause" })}>
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        <button className="button" onClick={() => run("Undo", () => api(`/api/host/boards/${boardId}/undo`, { body: {} }))}>
          Undo last change
        </button>
        <button className="button" onClick={() => run("Undo turn", () => api(`/api/host/boards/${boardId}/undo`, { body: { turn: true } }))}>
          Undo last turn
        </button>
      </div>

      <form className="row" onSubmit={add}>
        <input placeholder="Discord user ID" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <input placeholder="Display name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="button" disabled={!newId.trim()}>
          Add to this board
        </button>
      </form>

      <div className="row">
        <select value={pid} onChange={(e) => setTarget(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input className="narrow" value={coins} onChange={(e) => setCoins(e.target.value)} />
        <button className="button" disabled={!pid} onClick={() => action("Set coins", { type: "setCoins", playerId: pid, coins: Number(coins) })}>
          Set coins
        </button>
        <button className="button" disabled={!pid} onClick={() => action("Set stars", { type: "setStars", playerId: pid, stars: Number(coins) })}>
          Set stars
        </button>
      </div>

      <div className="row">
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">Move to board...</option>
          {boards
            .filter((b) => b.id !== boardId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> reset coins/stars/items
        </label>
        <button className="button" disabled={!pid || !dest} onClick={() => run("Transfer", () => api("/api/host/transfer", { body: { playerId: pid, to: dest, reset } }))}>
          Transfer
        </button>
      </div>

      <div className="row">
        <input className="narrow" placeholder="s62" value={starSpace} onChange={(e) => setStarSpace(e.target.value)} />
        <button className="button" disabled={!starSpace} onClick={() => action("Move star", { type: "moveStar", spaceId: starSpace.trim() })}>
          Move star
        </button>
        <button className="button" disabled={!pid || !starSpace} onClick={() => action("Move player", { type: "movePlayer", playerId: pid, spaceId: starSpace.trim() })}>
          Move player there
        </button>
      </div>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

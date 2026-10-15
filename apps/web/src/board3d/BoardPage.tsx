import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { describeEvent } from "@everest/engine";
import { ApiError, api, getToken, setToken, loginUrl, API_BASE } from "../lib/api";
import { useLiveBoard, type FeedEvent } from "../lib/useLiveBoard";
import { Board3D, type CamMode } from "./Board3D";
import { spaceToWorld } from "./coords";
import { TokenAnimator, type Popup } from "./Tokens";
import { BoardHud } from "./BoardHud";

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
  const [boardsLoaded, setBoardsLoaded] = useState(false);
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
        setBoardsLoaded(true);
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
        if (e.type === "PlayersSwapped") {
          // a single long hop each way, so the swap reads as a swap
          animator.enqueue(e.playerId as string, spaceToWorld(lay, e.playerTo as string));
          animator.enqueue(e.targetId as string, spaceToWorld(lay, e.targetTo as string));
        }
        if (e.type === "CoinsChanged" && e.reason !== "host" && e.delta !== 0) {
          const d = e.delta as number;
          add.push({ id: ++popupId.current, playerId: e.playerId as string, text: `${d > 0 ? "+" : ""}${d} 🪙`, tone: d > 0 ? "good" : "bad" });
        }
        if (e.type === "StarsChanged" && e.reason === "event") {
          const d = e.delta as number;
          add.push({ id: ++popupId.current, playerId: e.playerId as string, text: `${d > 0 ? "+" : ""}${d} ⭐`, tone: d > 0 ? "star" : "bad" });
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
  if (!boardsLoaded) return <div className="board-loading">Loading...</div>;
  if (!boardId) return <Login message="You aren't on a board yet. A host needs to add you." />;
  const lay = state ? layout(state.layoutId) : null;
  if (!state || !lay) return <div className="board-loading">Loading the board...</div>;

  const nameOf = (id: string) => state.players[id]?.name ?? "someone";
  const lines = feed
    .map((e) => ({ seq: e.seq, text: describeEvent(e.event as never, nameOf, itemName) }))
    .filter((l): l is { seq: number; text: string } => !!l.text)
    .slice(0, 6);

  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={lay} state={state} meId={me.user.id} avatars={{ ...avatars, [me.user.id]: me.user.avatar }} animator={animator} popups={popups} mode={mode} setMode={setMode} />
      </div>
      <BoardHud
        boardName={boards.find((b) => b.id === boardId)?.name ?? boardId}
        boards={boards}
        boardId={boardId}
        onBoard={setBoardId}
        status={status}
        state={state}
        layout={lay}
        season={season}
        meId={me.user.id}
        mode={mode}
        setMode={setMode}
        followTurns={followTurns}
        setFollowTurns={setFollowTurns}
        error={error}
        feed={lines}
        actions={{
          roll: () => run(() => api("/api/play/roll", { body: {} })),
          fork: (next) => run(() => api("/api/play/fork", { body: { next } })),
          star: (buy) => run(() => api("/api/play/star", { body: { buy } })),
          shop: (itemId) => run(() => api("/api/play/shop", { body: itemId ? { itemId } : {} })),
          event: (targetId) => run(() => api("/api/play/event", { body: targetId ? { targetId } : {} })),
        }}
      />
    </div>
  );
}

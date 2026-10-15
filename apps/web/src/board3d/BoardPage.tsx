import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { describeEvent } from "@everest/engine";
import { ApiError, api, getToken, setToken, loginUrl, API_BASE } from "../lib/api";
import { useLiveBoard, type FeedEvent } from "../lib/useLiveBoard";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";
import { BoardHud } from "./BoardHud";
import { Banner } from "./Banner";
import { EventReveal, StealWheel } from "./EventOverlays";
import { DiceOverlay } from "./DiceRoll";
import { useBoardAnimations } from "./useBoardAnimations";

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
      <h1>The Everest Party</h1>
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
      <a className="muted" href={`${import.meta.env.BASE_URL}credits.html`}>
        Credits
      </a>
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
  const [followTurns, setFollowTurns] = useState(true);
  const animator = useRef(new TokenAnimator()).current;
  const stateRef = useRef<ReturnType<typeof useLiveBoard>["state"]>(null);
  const meRef = useRef<string | null>(null);
  // where a Crystal Ball said the star goes next; cleared once the star moves
  const [compass, setCompass] = useState<string | null>(null);
  const { play, popups, dice, clearDice, banner, clearBanner, starDirector, flights, settled, reveal, clearReveal, wheel, clearWheel, hold } = useBoardAnimations({ animator, season, followTurns, setMode });

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

  // Live events drive the animation (dice, hops, pop-ups).
  const onLive = useCallback(
    (events: FeedEvent[]) => {
      const s = stateRef.current;
      const lay = s ? layouts[s.layoutId] : null;
      if (s && lay) play(events.map((e) => e.event as { type: string }), s, lay, meRef.current);
    },
    [play],
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
    animator.holdUntil.clear();
  }, [boardId, animator]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  meRef.current = me?.user.id ?? null;
  if (!token || !me) return <Login message={error} />;
  if (!boardsLoaded) return <div className="board-loading">Loading...</div>;
  if (!boardId) return <Login message="You aren't on a board yet. A host needs to add you." />;
  const lay = state ? layout(state.layoutId) : null;
  if (!state || !lay) return <div className="board-loading">Loading the board...</div>;

  const nameOf = (id: string) => state.players[id]?.name ?? "someone";
  const lines = feed
    // the narration's emoji suit Discord; the site's feed stays plain text
    .map((e) => ({ seq: e.seq, text: describeEvent(e.event as never, nameOf, itemName)?.replace(/\p{Extended_Pictographic}\p{Variation_Selector}?\s*/gu, "") ?? null }))
    .filter((l): l is { seq: number; text: string } => !!l.text)
    .slice(0, 6);

  return (
    <div className={`board-page ${lay.world?.theme === "night" ? "night" : ""}`}>
      <div className="board-canvas">
        <Board3D layout={lay} state={state} meId={me.user.id} avatars={{ ...avatars, [me.user.id]: me.user.avatar }} animator={animator} starDirector={starDirector} flights={flights} ghostStar={compass && compass !== state.star ? compass : null} ready={settled} onFork={(next) => run(() => api("/api/play/fork", { body: { next } }))} popups={popups} mode={mode} setMode={setMode} />
      </div>
      <DiceOverlay roll={dice} onDone={clearDice} />
      <Banner banner={banner} onDone={clearBanner} />
      <EventReveal show={reveal} onDone={clearReveal} />
      <StealWheel show={wheel} onDone={clearWheel} />
      <BoardHud
        boardName={boards.find((b) => b.id === boardId)?.name ?? boardId}
        boards={boards}
        boardId={boardId}
        onBoard={setBoardId}
        status={status}
        state={hold("state", state)}
        layout={lay}
        season={season}
        meId={me.user.id}
        mode={mode}
        setMode={setMode}
        followTurns={followTurns}
        setFollowTurns={setFollowTurns}
        error={error}
        ready={settled}
        feed={hold("feed", lines)}
        actions={{
          roll: () => run(() => api("/api/play/roll", { body: {} })),
          fork: (next) => run(() => api("/api/play/fork", { body: { next } })),
          star: (buy) => run(() => api("/api/play/star", { body: { buy } })),
          shop: (itemId) => run(() => api("/api/play/shop", { body: itemId ? { itemId } : {} })),
          event: (targetId) => run(() => api("/api/play/event", { body: targetId ? { targetId } : {} })),
          item: (itemId, targetId) =>
            run(async () => {
              const r = await api<{ nextStar?: string }>("/api/play/item", { body: targetId ? { itemId, targetId } : { itemId } });
              // a Crystal Ball: show where the star goes next, to this player only
              if (r.nextStar) {
                setCompass(r.nextStar);
                setMode({ kind: "star", at: r.nextStar });
              }
            }),
          pick: (value) => run(() => api("/api/play/pick", { body: { value } })),
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { BoardState } from "@everest/engine";
import { API_BASE, api } from "./api";

export interface FeedEvent {
  seq: number;
  at: number;
  event: { type: string; [k: string]: unknown };
}

export type LiveStatus = "connecting" | "live" | "offline" | "denied";

const HISTORY = 60;

// Keeps one board's state live over the websocket. The server sends the board's
// state with every batch of events, so the client never works out results itself.
// Gaps in seq (missed messages) trigger a resubscribe from the last good seq.
export function useLiveBoard(token: string | null, boardId: string | null) {
  const [state, setState] = useState<BoardState | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const seqRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token || !boardId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    seqRef.current = null;
    setFeed([]);
    setState(null);

    const subscribe = () => ws?.send(JSON.stringify({ op: "subscribe", board: boardId, since: seqRef.current ?? undefined }));

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(API_BASE.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => ws?.send(JSON.stringify({ op: "hello", token }));
      ws.onmessage = async (msg) => {
        const data = JSON.parse(String(msg.data));
        if (data.op === "hello") {
          retry = 0;
          subscribe();
        } else if (data.op === "snapshot" && data.board === boardId) {
          seqRef.current = data.seq;
          setState(data.state);
          setStatus("live");
          // Fill the feed with recent history for context.
          const since = Math.max(0, data.seq - HISTORY);
          const hist = await api<{ events: FeedEvent[] }>(`/api/boards/${boardId}/events?since=${since}`).catch(() => null);
          if (hist) setFeed(hist.events.filter((e) => e.seq <= data.seq).reverse());
        } else if (data.op === "events" && data.board === boardId) {
          const events = data.events as FeedEvent[];
          if (!events.length) return;
          if (seqRef.current !== null && events[0].seq !== seqRef.current + 1) {
            subscribe(); // gap: ask again from the last seq we have
            return;
          }
          seqRef.current = data.seq ?? events[events.length - 1].seq;
          setState(data.state);
          setStatus("live");
          setFeed((f) => [...events.slice().reverse(), ...f].slice(0, 300));
        } else if (data.op === "reset" && data.board === boardId) {
          seqRef.current = data.seq;
          setState(data.state);
          setFeed((f) => [{ seq: data.seq, at: Date.now(), event: { type: "Undone", count: 0 } }, ...f]);
        } else if (data.op === "error" && (data.code === "not_your_board" || data.code === "unauthenticated")) {
          setStatus("denied");
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("offline");
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [token, boardId]);

  return { state, feed, status };
}

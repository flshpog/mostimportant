import { useEffect, useMemo, useRef, useState } from "react";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState } from "@everest/engine";
import { Board3D, type CamMode } from "./Board3D";
import { TokenAnimator } from "./Tokens";

// #/preview: the 3D board with a few made-up players and no server, for checking the
// scene on any device without logging in.
export function Preview() {
  const layout = loadLayouts().main;
  const state = useMemo(() => {
    const ctx = { layout, rules: loadSeasonConfig() };
    let s = createBoardState(ctx, {
      boardId: "preview",
      starSpace: "s62",
      players: [
        { id: "p1", name: "Peach" },
        { id: "p2", name: "Toad" },
        { id: "p3", name: "Yoshi" },
        { id: "p4", name: "Daisy" },
      ],
    });
    s = apply(ctx, s, { type: "startBoard", now: 0 }).state;
    for (const [id, space] of [["p1", "s45"], ["p2", "s45"], ["p3", "s88"], ["p4", "s12"]] as const) {
      s = apply(ctx, s, { type: "movePlayer", playerId: id, spaceId: space, now: 0 }).state;
    }
    return s;
  }, [layout]);
  const animator = useRef(new TokenAnimator()).current;
  const [mode, setMode] = useState<CamMode>({ kind: "overview" });
  // ?debug shows a heartbeat and any errors, for headless screenshots
  const debug = window.location.hash.includes("debug");
  const [beat, setBeat] = useState(0);
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => {
    if (!debug) return;
    const t = setInterval(() => setBeat((b) => b + 1), 250);
    const out = () => document.getElementById("probe-out") ?? Object.assign(document.body.appendChild(document.createElement("pre")), { id: "probe-out" });
    const write = (m: string) => {
      const el = out();
      el.style.cssText = "position:fixed;left:8px;top:40px;z-index:99;background:#fee;color:#900;font:12px monospace;max-width:960px;white-space:pre-wrap";
      el.textContent = (el.textContent + " | " + m).slice(-3000);
    };
    (window as unknown as { __probeWrite: (m: string) => void }).__probeWrite = write;
    const onErr = (e: ErrorEvent) => { write("error: " + e.message + " @" + e.filename + ":" + e.lineno); setErrs((x) => [...x, e.message]); };
    const onRej = (e: PromiseRejectionEvent) => {
      write("rejected: " + String(e.reason?.stack ?? e.reason));
      setErrs((x) => [...x, "rejected: " + String(e.reason?.message ?? e.reason)]);
    };
    const orig = console.error;
    console.error = (...a: unknown[]) => { write("console.error: " + a.map((x) => (x instanceof Error ? x.stack : String(x))).join(" ").slice(0, 600)); setErrs((x) => [...x, a.map(String).join(" ").slice(0, 300)]); orig(...a); };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { clearInterval(t); console.error = orig; window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, [debug]);
  return (
    <div className="board-page">
      <div className="board-canvas">
        <Board3D layout={layout} state={state} meId="p1" avatars={{}} animator={animator} popups={[]} mode={mode} setMode={setMode} quality={window.location.hash.includes("lite") ? "lite" : "full"} />
      </div>
      {debug && (
        <pre style={{ position: "fixed", left: 8, top: 8, zIndex: 99, background: "#fff", color: "#000", font: "12px monospace", maxWidth: 900, whiteSpace: "pre-wrap" }}>
          beat {beat} · scenery {JSON.stringify((window as unknown as { __sceneryDebug?: unknown }).__sceneryDebug ?? null)}
          {" | "}errors: {JSON.stringify(errs.slice(0, 5))}
        </pre>
      )}
      <nav className="hud-cams">
        <button className={mode.kind === "overview" ? "active" : ""} onClick={() => setMode({ kind: "overview" })}>
          🗺️ Overview
        </button>
        <button onClick={() => setMode({ kind: "follow", playerId: "p1" })}>📍 Peach</button>
        <button onClick={() => setMode({ kind: "star" })}>⭐ Star</button>
      </nav>
    </div>
  );
}

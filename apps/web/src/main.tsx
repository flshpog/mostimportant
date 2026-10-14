import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DebugOverlay } from "./debug/DebugOverlay";
import { TestConsole } from "./console/TestConsole";
import { setToken } from "./lib/api";
import "./styles.css";

// Hash routing: GitHub Pages can't serve SPA fallbacks for /board/debug.
function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

// Login lands on #/auth?token=... (or ?error=...). Keep the token, then move on so it
// doesn't sit in the address bar or history.
function handleAuthRedirect(route: string): string {
  if (!route.startsWith("/auth")) return route;
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const token = params.get("token");
  if (token) setToken(token);
  const next = token ? "/console" : `/console?error=${params.get("error") ?? "login_failed"}`;
  window.history.replaceState(null, "", `#${next}`);
  return next;
}

function App() {
  const route = handleAuthRedirect(useHashRoute());
  if (route.startsWith("/debug")) return <DebugOverlay />;
  if (route.startsWith("/console")) return <TestConsole />;
  return (
    <main className="placeholder">
      <h1>Everest board</h1>
      <p>
        The board isn't live yet. <a href="#/console">Test console</a> · <a href="#/debug">Layout debug view</a>.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

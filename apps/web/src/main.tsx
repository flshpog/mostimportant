import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DebugOverlay } from "./debug/DebugOverlay";
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

function App() {
  const route = useHashRoute();
  if (route.startsWith("/debug")) return <DebugOverlay />;
  return (
    <main className="placeholder">
      <h1>Everest board</h1>
      <p>
        The board isn't live yet. <a href="#/debug">Open the layout debug view</a>.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

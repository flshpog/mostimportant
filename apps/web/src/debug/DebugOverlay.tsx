import { useMemo, useState, type MouseEvent } from "react";
import {
  BoardSchema,
  rawLayouts,
  rawSeasonConfig,
  SeasonConfigSchema,
  validateBoard,
  validateSeasonConfig,
  type Board,
  type Space,
  type SpaceType,
} from "@everest/board-data";
import referenceUrl from "@docs/board-reference.png";

const TYPE_COLORS: Record<SpaceType, string> = {
  blue: "#2f6fe4",
  red: "#e0393e",
  green: "#2ea94f",
  shop: "#9b4fc0",
  event: "#f2c230",
  start: "#f2a900",
};

const R = 9; // dot radius in reference-image pixels

// Draws board.json on top of the reference image so the owner can check every space
// and edge against the original. Read-only: fixes go into boards/main.json.
export function DebugOverlay() {
  const layoutId = "main";
  const raw = rawLayouts[layoutId];
  const report = useMemo(() => validateBoard(raw), [raw]);
  const parsed = BoardSchema.safeParse(raw);
  const config = SeasonConfigSchema.safeParse(rawSeasonConfig);
  const configErrors = useMemo(
    () => (parsed.success ? validateSeasonConfig(rawSeasonConfig, { [layoutId]: parsed.data }) : []),
    [parsed.success],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(true);
  const [imageOpacity, setImageOpacity] = useState(0.85);
  const [showEdges, setShowEdges] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  if (!parsed.success) {
    return (
      <div className="debug">
        <h1>Board debug</h1>
        <ErrorList errors={report.errors} />
      </div>
    );
  }

  const board: Board = parsed.data;
  const W = board.reference?.width ?? 1000;
  const H = board.reference?.height ?? 1000;
  const byId = new Map(board.spaces.map((s) => [s.id, s]));
  const px = (s: Space) => ({ x: s.pos.x * W, y: s.pos.y * H });
  const sel = selected ? byId.get(selected) : undefined;
  const incoming = sel ? board.spaces.filter((s) => s.next.includes(sel.id)).map((s) => s.id) : [];
  const bridgeKey = new Set(board.bridges.map((b) => `${b.from}>${b.to}`));
  const starStarts = config.success
    ? config.data.boards.filter((b) => b.layout === layoutId && b.starStart)
    : [];
  const starStartIds = new Set(starStarts.map((b) => b.starStart!));

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setCursor({ x: p.x, y: p.y });
  }

  return (
    <div className="debug">
      <header className="debug-header">
        <h1>{board.name}: layout check</h1>
        <p className="muted">
          {board.spaces.length} spaces ·{" "}
          {Object.entries(report.counts)
            .map(([t, n]) => `${t} ${n}`)
            .join(" · ")}{" "}
          · forks {report.forks.join(", ")}
        </p>
      </header>

      <ErrorList errors={[...report.errors, ...configErrors]} />
      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="debug-body">
        <div className="board-frame">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="board-svg"
            onMouseMove={onMove}
            onMouseLeave={() => setCursor(null)}
            onClick={() => setSelected(null)}
          >
            <defs>
              {(["edge", "out", "in", "bridge"] as const).map((k) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className={`arrowhead ${k}`} />
                </marker>
              ))}
            </defs>
            {showImage && <image href={referenceUrl} width={W} height={H} opacity={imageOpacity} />}
            {!showImage && <rect width={W} height={H} className="board-blank" />}

            {showEdges &&
              board.spaces.flatMap((s) =>
                s.next.map((n) => {
                  const to = byId.get(n);
                  if (!to) return null;
                  const a = px(s);
                  const b = px(to);
                  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                  const ux = (b.x - a.x) / len;
                  const uy = (b.y - a.y) / len;
                  const isBridge = bridgeKey.has(`${s.id}>${n}`);
                  const kind = sel?.id === s.id ? "out" : sel?.id === n ? "in" : isBridge ? "bridge" : "edge";
                  return (
                    <line
                      key={`${s.id}>${n}`}
                      x1={a.x + ux * (R + 1)}
                      y1={a.y + uy * (R + 1)}
                      x2={b.x - ux * (R + 2)}
                      y2={b.y - uy * (R + 2)}
                      className={`edge ${kind}`}
                      markerEnd={`url(#arrow-${kind})`}
                    />
                  );
                }),
              )}

            {board.spaces.map((s) => {
              const { x, y } = px(s);
              const isFork = s.next.length > 1;
              return (
                <g
                  key={s.id}
                  className={`space ${selected === s.id ? "selected" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(s.id);
                  }}
                >
                  {s.needsReview && <circle cx={x} cy={y} r={R + 7} className="ring-review" />}
                  {isFork && <circle cx={x} cy={y} r={R + 4} className="ring-fork" />}
                  <circle cx={x} cy={y} r={R} fill={TYPE_COLORS[s.type]} className="dot" />
                  {starStartIds.has(s.id) && <text x={x} y={y + 4} className="glyph">★</text>}
                  {s.type === "start" && <text x={x} y={y + 4} className="glyph">S</text>}
                  {showIds && (
                    <text x={x} y={y - R - 4} className="space-id">
                      {s.id.slice(1)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="panel">
          <section>
            <h2>Cursor</h2>
            <p className="mono">
              {cursor
                ? `px ${Math.round(cursor.x)}, ${Math.round(cursor.y)} · pos ${(cursor.x / W).toFixed(4)}, ${(cursor.y / H).toFixed(4)}`
                : "hover the board"}
            </p>
          </section>

          <section>
            <h2>Selected space</h2>
            {sel ? (
              <dl className="details">
                <dt>id</dt>
                <dd className="mono">{sel.id}</dd>
                <dt>type</dt>
                <dd>
                  <span className="swatch" style={{ background: TYPE_COLORS[sel.type] }} /> {sel.type}
                  {starStartIds.has(sel.id) ? " (starting star)" : ""}
                </dd>
                {sel.label && (
                  <>
                    <dt>label</dt>
                    <dd>{sel.label}</dd>
                  </>
                )}
                <dt>exits</dt>
                <dd className="mono">
                  <SpaceLinks ids={sel.next} onPick={setSelected} />
                  {sel.next.length > 1 ? " (fork)" : ""}
                </dd>
                <dt>from</dt>
                <dd className="mono">
                  <SpaceLinks ids={incoming} onPick={setSelected} />
                </dd>
                <dt>pos</dt>
                <dd className="mono">
                  {sel.pos.x}, {sel.pos.y}
                </dd>
                {sel.passEffect && (
                  <>
                    <dt>pass</dt>
                    <dd>triggers when passed</dd>
                  </>
                )}
                {sel.needsReview && (
                  <>
                    <dt>review</dt>
                    <dd className="review-note">{sel.reviewNote}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted">Click a space.</p>
            )}
          </section>

          <section>
            <h2>Needs review ({report.review.length})</h2>
            <ul className="review-list">
              {report.review.map((r) => (
                <li key={r.id}>
                  <button className="link mono" onClick={() => setSelected(r.id)}>
                    {r.id}
                  </button>{" "}
                  {r.note}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Starting star</h2>
            <ul className="plain">
              {starStarts.map((b) => (
                <li key={b.id}>
                  {b.name}:{" "}
                  <button className="link mono" onClick={() => setSelected(b.starStart!)}>
                    {b.starStart}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>View</h2>
            <label className="toggle">
              <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} /> reference image
            </label>
            <label className="toggle">
              image opacity
              <input type="range" min={0.1} max={1} step={0.05} value={imageOpacity} onChange={(e) => setImageOpacity(+e.target.value)} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} /> edges
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} /> space numbers
            </label>
          </section>

          <section>
            <h2>Legend</h2>
            <ul className="plain legend">
              {(Object.keys(TYPE_COLORS) as SpaceType[]).map((t) => (
                <li key={t}>
                  <span className="swatch" style={{ background: TYPE_COLORS[t] }} /> {t}
                </li>
              ))}
              <li>
                <span className="swatch ring fork" /> fork
              </li>
              <li>
                <span className="swatch ring review" /> needs review
              </li>
              <li>
                <span className="swatch line bridge" /> one-way bridge
              </li>
              <li>
                <span className="swatch line out" /> exits / <span className="swatch line in" /> entries of selected
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SpaceLinks({ ids, onPick }: { ids: string[]; onPick: (id: string) => void }) {
  if (!ids.length) return <>none</>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          <button className="link" onClick={() => onPick(id)}>
            {id}
          </button>
        </span>
      ))}
    </>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return <p className="ok">All structural checks pass.</p>;
  return (
    <ul className="errors">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Board, SpaceType } from "@everest/board-data";
import { currentPlayerId, type BoardState, type PlayerState } from "@everest/engine";

// Fonts ship with the bot (Nunito, OFL) so text renders on a bare server too.
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(require.resolve("@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf"), "NunitoXB");
  GlobalFonts.registerFromPath(require.resolve("@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf"), "NunitoB");
  fontsReady = true;
}

export interface RenderInput {
  layout: Board;
  state: BoardState;
  boardName: string;
  // Loaded avatar images by player id; missing or null draws an initial instead.
  avatars?: Map<string, Image | null>;
  now: number;
  // Force the flat 2D drawing even when a Blender backdrop exists.
  flat?: boolean;
}

// Layout size of the board picture. It's drawn at RES x that, so it stays sharp when
// Discord shows it large.
const W = 1400;
const H = 820;
const RES = 2;
const PANEL_X = 1030;
const BOARD = { x: 30, y: 30, w: 980, h: 760 };
const R = 13; // space radius

const SPACE_FILL: Record<SpaceType, string> = {
  blue: "#2f7de1",
  red: "#e5484d",
  green: "#3fb950",
  shop: "#8e4ec6",
  event: "#f2c230",
  start: "#f5a524",
};
const SPACE_GLYPH: Partial<Record<SpaceType, string>> = { shop: "S", event: "!", start: "GO" };
const TOKEN_COLORS = ["#ef476f", "#118ab2", "#06d6a0", "#ffd166", "#8338ec", "#fb5607", "#3a86ff", "#ff006e"];
const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

type Pt = { x: number; y: number };

// Fits the spaces' bounding box into the board area, keeping proportions, so the
// image uses its space well whatever the layout.
function projector(layout: Board) {
  const xs = layout.spaces.map((s) => s.pos.x);
  const ys = layout.spaces.map((s) => s.pos.y * ((layout.reference?.height ?? 1) / (layout.reference?.width ?? 1)));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 46;
  const scale = Math.min((BOARD.w - pad * 2) / (maxX - minX || 1), (BOARD.h - pad * 2) / (maxY - minY || 1));
  const offX = BOARD.x + (BOARD.w - (maxX - minX) * scale) / 2;
  const offY = BOARD.y + (BOARD.h - (maxY - minY) * scale) / 2;
  const aspect = (layout.reference?.height ?? 1) / (layout.reference?.width ?? 1);
  return (pos: { x: number; y: number }): Pt => ({ x: offX + (pos.x - minX) * scale, y: offY + (pos.y * aspect - minY) * scale });
}

// Deterministic pseudo-random numbers, so the scenery never jitters between renders.
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function hashColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TOKEN_COLORS[h % TOKEN_COLORS.length];
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx: SKRSContext2D, cx: number, cy: number, outer: number, inner: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

function fitText(ctx: SKRSContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

function drawBackground(ctx: SKRSContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#9bd97a");
  g.addColorStop(1, "#6fbf55");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // grass tufts and little bushes
  const rnd = seeded(7);
  for (let i = 0; i < 160; i++) {
    const x = rnd() * PANEL_X;
    const y = rnd() * H;
    ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(40,110,40,0.12)";
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + rnd() * 26, 6 + rnd() * 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few mushrooms around the edges, as a nod to the theme
  const spots: Pt[] = [
    { x: 40, y: 760 },
    { x: 985, y: 60 },
    { x: 990, y: 770 },
    { x: 48, y: 52 },
  ];
  for (const p of spots) {
    ctx.fillStyle = "#fff4dc";
    roundRect(ctx, p.x - 6, p.y - 2, 12, 16, 4);
    ctx.fill();
    ctx.fillStyle = "#e5484d";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 17, 12, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (const dx of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y - 5 - (dx === 0 ? 2 : 0), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPaths(ctx: SKRSContext2D, layout: Board, at: (id: string) => Pt) {
  const bridges = new Set(layout.bridges.map((b) => `${b.from}>${b.to}`));
  const edges = layout.spaces.flatMap((s) => s.next.map((n) => ({ from: s.id, to: n, bridge: bridges.has(`${s.id}>${n}`) })));
  ctx.lineCap = "round";
  // Outlines first, then fills, so overlapping paths merge cleanly.
  for (const pass of ["outline", "fill"] as const) {
    for (const e of edges) {
      const a = at(e.from);
      const b = at(e.to);
      ctx.strokeStyle = e.bridge ? (pass === "outline" ? "#4a2f17" : "#9a6533") : pass === "outline" ? "#7a5a30" : "#ecd5a3";
      ctx.lineWidth = pass === "outline" ? 22 : 15;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  for (const e of edges) {
    const a = at(e.from);
    const b = at(e.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (e.bridge) {
      // planks across the bridge
      ctx.strokeStyle = "#5b3a1c";
      ctx.lineWidth = 2;
      for (let d = 18; d < len - 18; d += 11) {
        const cx = a.x + Math.cos(ang) * d;
        const cy = a.y + Math.sin(ang) * d;
        ctx.beginPath();
        ctx.moveTo(cx - Math.sin(ang) * 7, cy + Math.cos(ang) * 7);
        ctx.lineTo(cx + Math.sin(ang) * 7, cy - Math.cos(ang) * 7);
        ctx.stroke();
      }
    }
    // direction chevrons; bigger on the one-way bridges
    const size = e.bridge ? 11 : 6;
    const marks = e.bridge ? [0.3, 0.5, 0.7] : len > 48 ? [0.5] : [];
    ctx.strokeStyle = e.bridge ? "#ffe08a" : "rgba(122,90,48,0.85)";
    ctx.lineWidth = e.bridge ? 3.5 : 2.5;
    for (const f of marks) {
      const cx = a.x + (b.x - a.x) * f;
      const cy = a.y + (b.y - a.y) * f;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang - 0.6) * size, cy - Math.sin(ang - 0.6) * size);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - Math.cos(ang + 0.6) * size, cy - Math.sin(ang + 0.6) * size);
      ctx.stroke();
    }
  }
}

function drawSpaces(ctx: SKRSContext2D, layout: Board, at: (id: string) => Pt) {
  for (const s of layout.spaces) {
    const p = at(s.id);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(p.x + 1.5, p.y + 2.5, R + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, R + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SPACE_FILL[s.type];
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fill();
    // a soft highlight for a little depth
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.ellipse(p.x - 3, p.y - 4, R * 0.55, R * 0.35, -0.4, 0, Math.PI * 2);
    ctx.fill();
    const glyph = SPACE_GLYPH[s.type];
    if (glyph) {
      ctx.fillStyle = s.type === "event" ? "#5a3d00" : "#ffffff";
      ctx.font = `${glyph.length > 1 ? 10 : 13}px NunitoXB`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, p.x, p.y + 1);
    }
  }
}

function drawStar(ctx: SKRSContext2D, p: Pt) {
  ctx.save();
  ctx.shadowColor = "rgba(255,220,80,0.95)";
  ctx.shadowBlur = 22;
  starPath(ctx, p.x, p.y - 2, 22, 9.5);
  ctx.fillStyle = "#ffd43b";
  ctx.fill();
  ctx.restore();
  starPath(ctx, p.x, p.y - 2, 22, 9.5);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#b07d00";
  ctx.stroke();
  ctx.fillStyle = "#3a2a00";
  for (const dx of [-4, 4]) {
    ctx.beginPath();
    ctx.ellipse(p.x + dx, p.y - 3, 1.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAvatar(ctx: SKRSContext2D, p: PlayerState, c: Pt, r: number, img: Image | null | undefined, ring: string, ringW: number) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.arc(c.x + 1.5, c.y + 2.5, r + ringW, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r + ringW, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, c.x - r, c.y - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = hashColor(p.id);
    ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(r * 1.05)}px NunitoXB`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((p.name.trim()[0] ?? "?").toUpperCase(), c.x, c.y + 1);
  }
  ctx.restore();
}

function drawTokens(ctx: SKRSContext2D, state: BoardState, at: (id: string) => Pt, avatars: Map<string, Image | null>, size = 1) {
  const bySpace = new Map<string, PlayerState[]>();
  for (const id of state.turn.order) {
    const p = state.players[id];
    if (p) bySpace.set(p.space, [...(bySpace.get(p.space) ?? []), p]);
  }
  const current = currentPlayerId(state);
  for (const [space, players] of bySpace) {
    const c = at(space);
    players.forEach((p, i) => {
      // One token sits just above the space; a crowd fans out around it.
      const n = players.length;
      const ang = -Math.PI / 2 + (n === 1 ? 0 : ((i - (n - 1) / 2) * Math.PI) / Math.max(3, n));
      const dist = (n === 1 ? 20 : 26) * size;
      const pos = { x: c.x + Math.cos(ang) * dist, y: c.y + Math.sin(ang) * dist - 4 * size };
      const isCurrent = p.id === current && state.started;
      drawAvatar(ctx, p, pos, 15 * size, avatars.get(p.id), isCurrent ? "#ffd43b" : "#ffffff", (isCurrent ? 4 : 3) * Math.sqrt(size));
    });
  }
}

function coinIcon(ctx: SKRSContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#f5b301";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a87800";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffe48a";
  ctx.fillRect(x - 1.5, y - r * 0.55, 3, r * 1.1);
}

function drawPanel(ctx: SKRSContext2D, input: RenderInput, avatars: Map<string, Image | null>) {
  const { state, boardName, now } = input;
  const x = PANEL_X;
  const w = W - x - 24;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, x + 3, 27, w, H - 54, 20);
  ctx.fill();
  ctx.fillStyle = "#fffaf0";
  roundRect(ctx, x, 24, w, H - 54, 20);
  ctx.fill();

  const pad = x + 22;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#2b2140";
  ctx.font = "30px NunitoXB";
  ctx.fillText(fitText(ctx, boardName, w - 44), pad, 70);

  ctx.font = "17px NunitoB";
  ctx.fillStyle = "#6b5f80";
  const current = currentPlayerId(state);
  let status: string;
  if (!state.started) status = "Waiting for the hosts to start";
  else if (state.paused) status = "Paused by the hosts";
  else if (!current) status = "No players";
  else {
    const name = state.players[current]?.name ?? "?";
    const opens = state.turn.windowOpensAt;
    status = state.move ? `${name} is moving` : opens !== null && opens > now ? `${name} is up at ${NY.format(opens)} ET` : `${name}'s turn to roll`;
  }
  ctx.fillText(fitText(ctx, status, w - 44), pad, 100);

  // leaderboard: stars, then coins
  const rows = Object.values(state.players).sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
  let y = 150;
  ctx.font = "14px NunitoXB";
  ctx.fillStyle = "#a397b8";
  ctx.fillText("STANDINGS", pad, y - 18);
  let rank = 0;
  rows.forEach((p, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.stars !== p.stars || prev.coins !== p.coins) rank = i + 1;
    if (i % 2 === 0) {
      ctx.fillStyle = "#f4ecdc";
      roundRect(ctx, pad - 10, y - 4, w - 24, 52, 12);
      ctx.fill();
    }
    ctx.fillStyle = "#2b2140";
    ctx.font = "20px NunitoXB";
    ctx.textAlign = "center";
    ctx.fillText(String(rank), pad + 8, y + 29);
    drawAvatar(ctx, p, { x: pad + 44, y: y + 22 }, 17, avatars.get(p.id), p.id === current && state.started ? "#ffd43b" : "#ffffff", 3);
    ctx.textAlign = "left";
    ctx.font = "19px NunitoXB";
    ctx.fillStyle = "#2b2140";
    ctx.fillText(fitText(ctx, p.name, w - 220), pad + 72, y + 22);
    ctx.font = "14px NunitoB";
    ctx.fillStyle = "#7a6e8f";
    ctx.fillText(`${p.items.length} item${p.items.length === 1 ? "" : "s"}`, pad + 72, y + 41);
    // stars and coins, right-aligned
    const right = x + w - 22;
    ctx.font = "19px NunitoXB";
    ctx.textAlign = "right";
    ctx.fillStyle = "#2b2140";
    ctx.fillText(String(p.coins), right, y + 31);
    const coinsW = ctx.measureText(String(p.coins)).width;
    coinIcon(ctx, right - coinsW - 14, y + 24, 8);
    const starX = right - coinsW - 40;
    ctx.fillStyle = "#2b2140";
    ctx.fillText(String(p.stars), starX, y + 31);
    const starsW = ctx.measureText(String(p.stars)).width;
    starPath(ctx, starX - starsW - 13, y + 24, 10, 4.4);
    ctx.fillStyle = "#ffd43b";
    ctx.fill();
    ctx.strokeStyle = "#b07d00";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "left";
    y += 58;
  });

  // legend
  const legend: [SpaceType, string][] = [
    ["blue", "+3 coins"],
    ["red", "-3 coins"],
    ["green", "nothing"],
    ["shop", "shop"],
    ["event", "event"],
  ];
  let ly = H - 64 - legend.length * 26;
  ctx.font = "14px NunitoXB";
  ctx.fillStyle = "#a397b8";
  ctx.fillText("SPACES", pad, ly - 8);
  ctx.font = "16px NunitoB";
  for (const [t, label] of legend) {
    ctx.fillStyle = SPACE_FILL[t];
    ctx.beginPath();
    ctx.arc(pad + 8, ly + 10, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a3f5c";
    ctx.fillText(label, pad + 26, ly + 16);
    ly += 26;
  }
}

// Draws the board as a PNG. Pure apart from fonts: same input, same image.
// A still of the 3D board rendered in Blender (art/board.blend, DiscordCam), plus where
// each space landed in it. When one exists for a layout, it replaces the flat drawing.
interface Backdrop {
  image: Image;
  // in the image's own pixels
  width: number;
  height: number;
  spaces: Record<string, [number, number]>;
  // image pixels per layout pixel (a 2000px render of a 1000px layout is 2)
  pixelRatio: number;
}
const backdrops = new Map<string, Backdrop | null>();

// Image decoding is async, so backdrops are loaded once up front. Call before rendering;
// until it has run, boards fall back to the flat drawing.
export async function prepareBackdrops(layoutIds: string[]): Promise<void> {
  const dir = join(__dirname, "..", "assets");
  for (const id of layoutIds) {
    const metaPath = join(dir, `backdrop-${id}.json`);
    if (!existsSync(metaPath)) {
      backdrops.set(id, null);
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const image = await loadImage(readFileSync(join(dir, meta.image)));
    backdrops.set(id, { image, width: meta.width, height: meta.height, spaces: meta.spaces, pixelRatio: meta.pixelRatio ?? 1 });
  }
}

function backdropFor(layoutId: string): Backdrop | null {
  return backdrops.get(layoutId) ?? null;
}

function drawSky(ctx: SKRSContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3d8fe8");
  g.addColorStop(1, "#a9dcff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Draws the board as a JPEG. Pure apart from fonts and the backdrop file: same input,
// same image.
export function renderBoard(input: RenderInput): Buffer {
  registerFonts();
  const canvas = createCanvas(W * RES, H * RES);
  const ctx = canvas.getContext("2d");
  ctx.scale(RES, RES);
  const avatars = input.avatars ?? new Map();
  const backdrop = input.flat ? null : backdropFor(input.layout.id);
  let at: (id: string) => Pt;
  if (backdrop) {
    // Fit the render into the board area, left of the panel.
    const scale = Math.min((PANEL_X - 20) / backdrop.width, (H - 20) / backdrop.height);
    const ox = 10 + (PANEL_X - 20 - backdrop.width * scale) / 2;
    const oy = 10 + (H - 20 - backdrop.height * scale) / 2;
    drawSky(ctx);
    ctx.drawImage(backdrop.image, ox, oy, backdrop.width * scale, backdrop.height * scale);
    at = (id) => {
      const [x, y] = backdrop.spaces[id] ?? [0, 0];
      return { x: ox + x * scale, y: oy + y * scale };
    };
  } else {
    const project = projector(input.layout);
    const byId = new Map(input.layout.spaces.map((s) => [s.id, s]));
    at = (id) => project(byId.get(id)!.pos);
    drawBackground(ctx);
    drawPaths(ctx, input.layout, at);
    drawSpaces(ctx, input.layout, at);
  }
  if (input.state.star && input.layout.spaces.some((s) => s.id === input.state.star)) drawStar(ctx, at(input.state.star));
  drawTokens(ctx, input.state, at, avatars);
  drawPanel(ctx, input, avatars);
  return canvas.toBuffer("image/jpeg", 86);
}

export const BOARD_IMAGE_SIZE = { width: W * RES, height: H * RES };

// ---- fork close-up ----

// Fork paths, in the order of the buttons: Discord's blurple, green, red and grey
// button colours, so each arrow on the picture matches its button.
export const FORK_PATH_COLOURS = ["#5865f2", "#248046", "#da373c", "#4e5058"];

// The board without the side panel, at the backdrop's own size: what a close-up
// is cut from.
// Coordinates are layout pixels; the canvas holds `ratio` image pixels per layout pixel.
function drawScene(input: RenderInput, opts: { tokens?: boolean } = {}): { canvas: Canvas; at: (id: string) => Pt; ratio: number } {
  const avatars = input.avatars ?? new Map();
  const backdrop = input.flat ? null : backdropFor(input.layout.id);
  let canvas: Canvas;
  let at: (id: string) => Pt;
  let ratio: number;
  if (backdrop) {
    ratio = backdrop.pixelRatio;
    canvas = createCanvas(backdrop.width, backdrop.height);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    drawSky(ctx);
    ctx.drawImage(backdrop.image, 0, 0, backdrop.width / ratio, backdrop.height / ratio);
    at = (id) => {
      const [x, y] = backdrop.spaces[id] ?? [0, 0];
      return { x: x / ratio, y: y / ratio };
    };
  } else {
    ratio = RES;
    canvas = createCanvas(W * RES, H * RES);
    const ctx = canvas.getContext("2d");
    ctx.scale(RES, RES);
    const project = projector(input.layout);
    const byId = new Map(input.layout.spaces.map((s) => [s.id, s]));
    at = (id) => project(byId.get(id)!.pos);
    drawBackground(ctx);
    drawPaths(ctx, input.layout, at);
    drawSpaces(ctx, input.layout, at);
  }
  const ctx = canvas.getContext("2d");
  if (input.state.star && input.layout.spaces.some((s) => s.id === input.state.star)) drawStar(ctx, at(input.state.star));
  if (opts.tokens !== false) drawTokens(ctx, input.state, at, avatars);
  return { canvas, at, ratio };
}

// Where each choice at a fork leads: the spaces you'd step through (up to the steps
// left), where you'd land, or the next fork if you'd reach one first.
export function forkRoute(layout: Board, first: string, steps: number): { ids: string[]; end: "land" | "fork" } {
  const byId = new Map(layout.spaces.map((s) => [s.id, s]));
  const ids: string[] = [];
  let cur = first;
  for (let i = 1; i <= Math.max(1, steps); i++) {
    ids.push(cur);
    if (i === steps) return { ids, end: "land" };
    const sp = byId.get(cur);
    if (!sp) break;
    if (sp.next.length > 1) return { ids, end: "fork" };
    cur = sp.next[0];
  }
  return { ids, end: "land" };
}

// A zoomed-in picture of a fork. Each path's spaces get a ring in its button's colour,
// one per step, so the tiles stay visible; the space you'd land on (or the next fork)
// gets a thick ring and a label. A short pointer from the player shows which way each
// path leaves. Sent with the fork prompt so the player can see what they're choosing.
export function renderForkCloseup(input: RenderInput & { fork: string; steps: number; options: { next: string; label: string }[] }): Buffer {
  registerFonts();
  // tokens go on last, over the markings, so the player is never hidden
  const { canvas: scene, at, ratio } = drawScene(input, { tokens: false });
  const sceneW = scene.width / ratio;
  const sceneH = scene.height / ratio;
  const routes = input.options.map((o) => forkRoute(input.layout, o.next, input.steps));
  const fork = at(input.fork);

  // Frame the fork and every route, padded, at 16:10, never zoomed in too far.
  const all = [fork, ...routes.flatMap((r) => r.ids.map(at))];
  const pad = 60;
  const minX = Math.min(...all.map((p) => p.x)) - pad;
  const maxX = Math.max(...all.map((p) => p.x)) + pad;
  const minY = Math.min(...all.map((p) => p.y)) - pad - 30; // room for labels above
  const maxY = Math.max(...all.map((p) => p.y)) + pad;
  let w = Math.max(maxX - minX, 320);
  let h = Math.max(maxY - minY, 320 / 1.6);
  if (w / h > 1.6) h = w / 1.6;
  else w = h * 1.6;
  w = Math.min(w, sceneW);
  h = Math.min(h, sceneH);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x0 = Math.min(Math.max(0, cx - w / 2), Math.max(0, sceneW - w));
  const y0 = Math.min(Math.max(0, cy - h / 2), Math.max(0, sceneH - h));
  const OUT_W = 1000;
  const OUT_H = Math.round(OUT_W * (h / w));
  const k = OUT_W / w;
  const out = createCanvas(OUT_W * RES, OUT_H * RES);
  const ctx = out.getContext("2d");
  ctx.scale(RES, RES);
  ctx.drawImage(scene, x0 * ratio, y0 * ratio, w * ratio, h * ratio, 0, 0, OUT_W, OUT_H);
  const toOut = (p: Pt): Pt => ({ x: (p.x - x0) * k, y: (p.y - y0) * k });
  const INK = "#2b2340";
  const tileR = 15 * k; // a tile's radius, in output pixels

  const ring = (p: Pt, r: number, colour: string, width: number) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.lineWidth = width + 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.stroke();
  };
  const pill = (text: string, colour: string, anchor: Pt, above: boolean) => {
    ctx.font = "22px NunitoXB";
    const bw = ctx.measureText(text).width + 22;
    const bh = 34;
    let lx = anchor.x - bw / 2;
    let ly = above ? anchor.y - tileR - 16 - bh : anchor.y + tileR + 16;
    lx = Math.min(Math.max(6, lx), OUT_W - bw - 6);
    ly = Math.min(Math.max(6, ly), OUT_H - bh - 6);
    roundRect(ctx, lx, ly, bw, bh, 9);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, lx + bw / 2, ly + bh / 2 + 1);
  };

  const forkOut = toOut(fork);
  routes.forEach((route, i) => {
    const colour = FORK_PATH_COLOURS[i % FORK_PATH_COLOURS.length];
    const pts = route.ids.map((id) => toOut(at(id)));
    // a short pointer from the fork towards the first space of this path
    const first = pts[0];
    const dx = first.x - forkOut.x;
    const dy = first.y - forkOut.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tail = { x: forkOut.x + ux * tileR * 1.15, y: forkOut.y + uy * tileR * 1.15 };
    const tip = { x: first.x - ux * tileR * 1.25, y: first.y - uy * tileR * 1.25 };
    if (Math.hypot(tip.x - tail.x, tip.y - tail.y) > 14) {
      const neck = { x: tip.x - ux * 13, y: tip.y - uy * 13 };
      const arrow = () => {
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(neck.x, neck.y);
      };
      const head = () => {
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(neck.x - uy * 11, neck.y + ux * 11);
        ctx.lineTo(neck.x + uy * 11, neck.y - ux * 11);
        ctx.closePath();
      };
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 12;
      arrow();
      ctx.stroke();
      head();
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 6;
      arrow();
      ctx.stroke();
      ctx.fillStyle = colour;
      head();
      ctx.fill();
    }
    // a thin ring on every step, a thick one where the move ends
    pts.forEach((p, j) => {
      const last = j === pts.length - 1;
      ring(p, tileR + 3 + i * 3, colour, last ? 6 : 2.5);
    });
    const end = pts[pts.length - 1];
    const steps = route.ids.length;
    const label = route.end === "fork" ? `${input.options[i].label} · fork in ${steps}` : `${input.options[i].label} · lands here`;
    // put the label on the side away from the fork, so it doesn't sit on the player
    pill(label, colour, end, end.y <= forkOut.y);
  });
  drawTokens(ctx, input.state, (id) => toOut(at(id)), input.avatars ?? new Map(), Math.min(1.5, k * 0.55));
  return out.toBuffer("image/jpeg", 88);
}

// Item pictures, drawn to match the board UI: flat colours with one ink outline.
// 64x64, by item id. Unknown ids get a plain box.
const INK = "#2b2340";
const W = 3; // outline width

function Mushroom({ cap, spots, stem = "#fff3dc", face = true, frown = false }: { cap: string; spots: string; stem?: string; face?: boolean; frown?: boolean }) {
  return (
    <>
      <path d="M22 36h20l2 16a4 4 0 01-4 4.5H24a4 4 0 01-4-4.5z" fill={stem} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      {face && (
        <>
          <ellipse cx="28" cy="44" rx="2" ry="3.5" fill={INK} />
          <ellipse cx="36" cy="44" rx="2" ry="3.5" fill={INK} />
          {frown && <path d="M28 52q4-3 8 0" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />}
        </>
      )}
      <path d="M8 36c0-14 10.7-25 24-25s24 11 24 25c0 2-1.6 3-3.4 3H11.4C9.6 39 8 38 8 36z" fill={cap} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <circle cx="32" cy="21" r="6" fill={spots} />
      <circle cx="17" cy="30" r="4.5" fill={spots} />
      <circle cx="47" cy="30" r="4.5" fill={spots} />
    </>
  );
}

const ART: Record<string, React.ReactNode> = {
  mushroom: <Mushroom cap="#e5484d" spots="#fff" />,
  "golden-mushroom": (
    <>
      <Mushroom cap="#f5b100" spots="#fff3b0" />
      <path d="M52 8l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#fff3b0" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
    </>
  ),
  "slow-mushroom": (
    <>
      <Mushroom cap="#4fa3e0" spots="#e8f6ff" />
      <text x="32" y="25" textAnchor="middle" fontSize="11" fontWeight="900" fontFamily="Nunito, sans-serif" fill={INK}>
        1-5
      </text>
    </>
  ),
  // Bullet Bill
  "fast-mushroom": (
    <>
      <path d="M2 24h7M0 32h6M2 40h7" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14 18h22c10 0 18 6 18 14s-8 14-18 14H14z" fill="#2b2b33" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <rect x="10" y="16" width="7" height="32" rx="2" fill="#4a4a55" stroke={INK} strokeWidth="2.6" />
      <ellipse cx="38" cy="28" rx="5" ry="6" fill="#fff" stroke={INK} strokeWidth="2" />
      <circle cx="39.5" cy="28.5" r="2.2" fill={INK} />
      <path d="M33 21l9 3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="28" cy="44" rx="5" ry="3.5" fill="#fff" stroke={INK} strokeWidth="2.2" />
    </>
  ),
  "poison-mushroom": <Mushroom cap="#8e4ec6" spots="#3b1d5c" frown />,
  // Custom Dice Block
  "reroll-block": (
    <>
      <rect x="9" y="9" width="46" height="46" rx="8" fill="#5bc0eb" stroke={INK} strokeWidth={W} />
      <circle cx="15.5" cy="15.5" r="2" fill={INK} />
      <circle cx="48.5" cy="15.5" r="2" fill={INK} />
      <circle cx="15.5" cy="48.5" r="2" fill={INK} />
      <circle cx="48.5" cy="48.5" r="2" fill={INK} />
      <text x="32" y="42" textAnchor="middle" fontSize="27" fontWeight="900" fontFamily="Nunito, sans-serif" fill="#fff" stroke={INK} strokeWidth="2.2" paintOrder="stroke">
        ?
      </text>
    </>
  ),
  "magic-lamp": (
    <>
      <path d="M12 40h34c-1 7-7.5 11-17 11S13 47 12 40z" fill="#f5b100" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M46 42c5-1 9-5 11-11" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />
      <path d="M12 42c-4 0-7-3-6-7" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />
      <path d="M20 40c0-6 4-10 9-10s9 4 9 10" fill="#ffd84d" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <circle cx="29" cy="27" r="3" fill="#ffd84d" stroke={INK} strokeWidth="2.4" />
      <rect x="19" y="51" width="20" height="5" rx="2.5" fill="#c98a00" stroke={INK} strokeWidth="2.4" />
      <path d="M50 8l1.4 3.6 3.6 1.4-3.6 1.4L50 18l-1.4-3.6L45 13l3.6-1.4z" fill="#fff3b0" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </>
  ),
  // Crystal Ball
  "star-compass": (
    <>
      <path d="M17 50h30l-4 7H21z" fill="#c98a00" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <circle cx="32" cy="30" r="20" fill="#b9a6ff" stroke={INK} strokeWidth={W} />
      <circle cx="32" cy="30" r="13" fill="#d9ceff" />
      <path d="M32 21l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#ffd21f" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M21 22a13 13 0 017-6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  // Blue Shell
  "guard-charm": (
    <>
      <path d="M8 40c0-14 11-26 24-26s24 12 24 26z" fill="#2f6fe0" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M20 22l-4-9 9 4M44 22l4-9-9 4M32 15V5" fill="#f4f1e8" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M32 18l8 6-3 10H27l-3-10z" fill="#5a93f0" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="5" y="39" width="54" height="9" rx="4.5" fill="#f4f1e8" stroke={INK} strokeWidth={W} />
      <path d="M50 34c6-4 10-2 10 2-4 0-7 1-10 3z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  "boo-bell": (
    <>
      <path d="M32 7a3.5 3.5 0 013.5 3.5V12c9 2 14 10 14 20v10l5 6H9.5l5-6V32c0-10 5-18 14-20v-1.5A3.5 3.5 0 0132 7z" fill="#f4f1ff" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <circle cx="32" cy="53" r="4" fill="#f2c230" stroke={INK} strokeWidth="2.4" />
      <ellipse cx="26" cy="29" rx="2.4" ry="4" fill={INK} />
      <ellipse cx="38" cy="29" rx="2.4" ry="4" fill={INK} />
      <path d="M25 38q7 6 14 0" fill="#e5484d" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M28 38.7l1.5 2.3 1.4-2" fill="#fff" />
    </>
  ),
};

// Real sprites, if the hosts have dropped any in: src/item-sprites/<item id>.png (or
// .webp/.svg). Vite picks them up at build time; any item without one keeps its
// drawing below.
const SPRITES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../item-sprites/*.{png,webp,svg}", { eager: true, import: "default", query: "?url" }) as Record<string, string>).map(([path, url]) => [
    path.replace(/^.*\/|\.[^.]+$/g, ""),
    url,
  ]),
);
export const itemSprite = (id: string): string | undefined => SPRITES[id];

export function ItemArt({ id, size = 40, className }: { id: string; size?: number; className?: string }) {
  const sprite = SPRITES[id];
  if (sprite) return <img className={`item-art ${className ?? ""}`} src={sprite} width={size} height={size} alt="" style={{ objectFit: "contain" }} />;
  return (
    <svg className={`item-art ${className ?? ""}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {ART[id] ?? <rect x="12" y="12" width="40" height="40" rx="8" fill="#fff8ec" stroke={INK} strokeWidth={W} />}
    </svg>
  );
}

// Dice colours by item, so special rolls look different (the plain die is the
// roller's own colour).
export const ITEM_DICE_COLOURS: Record<string, string> = {
  mushroom: "#e5484d",
  "golden-mushroom": "#f5b100",
  "slow-mushroom": "#4fa3e0",
  "fast-mushroom": "#3a3a46",
  "reroll-block": "#f2c230",
};

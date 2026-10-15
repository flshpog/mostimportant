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
  "fast-mushroom": (
    <>
      <path d="M2 22h8M0 30h7M3 38h6" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mushroom cap="#f97316" spots="#ffe1c2" />
      <text x="32" y="25" textAnchor="middle" fontSize="10" fontWeight="900" fontFamily="Nunito, sans-serif" fill={INK}>
        6-10
      </text>
    </>
  ),
  "poison-mushroom": <Mushroom cap="#8e4ec6" spots="#3b1d5c" frown />,
  "reroll-block": (
    <>
      <rect x="9" y="9" width="46" height="46" rx="8" fill="#f2c230" stroke={INK} strokeWidth={W} />
      <circle cx="15.5" cy="15.5" r="2" fill={INK} />
      <circle cx="48.5" cy="15.5" r="2" fill={INK} />
      <circle cx="15.5" cy="48.5" r="2" fill={INK} />
      <circle cx="48.5" cy="48.5" r="2" fill={INK} />
      <path d="M22 28a11 11 0 0118.5-5M42 36a11 11 0 01-18.5 5" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M41 16.5l.5 7-7 .3M23 47.5l-.5-7 7-.3" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
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
  "star-compass": (
    <>
      <circle cx="32" cy="34" r="22" fill="#fff8ec" stroke={INK} strokeWidth={W} />
      <circle cx="32" cy="34" r="16" fill="none" stroke="#d9cdb6" strokeWidth="2" />
      <rect x="28" y="6" width="8" height="7" rx="2" fill="#c98a00" stroke={INK} strokeWidth="2.4" />
      <path d="M32 18l4.5 16H27.5z" fill="#e5484d" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M32 50l-4.5-16h9z" fill="#9aa3b5" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M32 28.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" fill="#ffd21f" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  "guard-charm": (
    <>
      <path d="M32 6l20 7v15c0 13-8.5 23-20 29-11.5-6-20-16-20-29V13z" fill="#34a853" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M32 13l13 4.6v10.6c0 9-5.6 16-13 20.5-7.4-4.5-13-11.5-13-20.5V17.6z" fill="#7fd99a" />
      <path d="M32 22l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
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

export function ItemArt({ id, size = 40, className }: { id: string; size?: number; className?: string }) {
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
  "fast-mushroom": "#f97316",
  "reroll-block": "#f2c230",
};

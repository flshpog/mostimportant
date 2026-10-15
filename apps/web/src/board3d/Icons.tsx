// Small inline icons for the HUD, drawn to sit on the text baseline at 1em.
type P = { className?: string };
const svg = (className: string | undefined, children: React.ReactNode, viewBox = "0 0 24 24") => (
  <svg className={`icon ${className ?? ""}`} viewBox={viewBox} aria-hidden="true">
    {children}
  </svg>
);

export const CoinIcon = ({ className }: P) =>
  svg(
    `coin ${className ?? ""}`,
    <>
      <circle cx="12" cy="12" r="10" fill="#f5b100" stroke="#b97800" strokeWidth="2" />
      <rect x="10" y="6.5" width="4" height="11" rx="2" fill="#fff3b0" />
    </>,
  );

export const StarIcon = ({ className }: P) =>
  svg(
    `star ${className ?? ""}`,
    <path
      d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"
      fill="#ffd21f"
      stroke="#c98a00"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />,
  );

const line = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;

export const MapIcon = ({ className }: P) => svg(className, line("M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20"));
export const PinIcon = ({ className }: P) =>
  svg(
    className,
    <>
      {line("M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z")}
      <circle cx="12" cy="9.5" r="2.6" fill="currentColor" />
    </>,
  );
export const OutlineStarIcon = ({ className }: P) => svg(className, line("M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"));
export const FollowIcon = ({ className }: P) =>
  svg(
    className,
    <>
      {line("M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3")}
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    </>,
  );
export const DiceIcon = ({ className }: P) =>
  svg(
    className,
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </>,
  );

// An arrow pointing at `deg` (0 = right, 90 = up).
export const ArrowIcon = ({ className, deg }: P & { deg: number }) => (
  <svg className={`icon ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-deg}deg)` }}>
    <path d="M4 12h14M12.5 5.5L19 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ShopIcon = ({ className }: P) =>
  svg(
    className,
    <>
      {line("M5 8h14l-1.2 11.2a2 2 0 01-2 1.8H8.2a2 2 0 01-2-1.8z")}
      {line("M9 8V6.5a3 3 0 016 0V8")}
    </>,
  );

export const BangIcon = ({ className }: P) =>
  svg(
    className,
    <>
      <path d="M12 4v10" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="12" cy="19.5" r="2" fill="currentColor" />
    </>,
  );

export const SwapIcon = ({ className }: P) =>
  svg(
    className,
    <>
      {line("M4 8h13M13.5 4.5L17 8l-3.5 3.5")}
      {line("M20 16H7M10.5 12.5L7 16l3.5 3.5")}
    </>,
  );

import { useEffect, useState } from "react";
import { EVENT_NAMES, type EventChoiceKind } from "@everest/engine";
import { BangIcon, CoinIcon, StarIcon, SwapIcon } from "./Icons";

export interface RevealShow {
  key: number;
  event: EventChoiceKind;
  name: string;
  mine: boolean;
}
export interface WheelShow {
  key: number;
  percents: number[];
  percent: number;
  thief: string;
  target: string;
  mine: boolean;
}

const ORDER: EventChoiceKind[] = ["coinSteal", "starSteal", "swap"];
const ICONS: Record<EventChoiceKind, React.ReactNode> = { coinSteal: <CoinIcon />, starSteal: <StarIcon />, swap: <SwapIcon /> };

// The highlight hops card to card, slowing down, and stops on the drawn event.
const HOPS = 9;
const hopDelay = (i: number) => 90 + i * i * 9;
const REVEAL_SPIN_MS = Array.from({ length: HOPS }, (_, i) => hopDelay(i)).reduce((a, b) => a + b, 0);
export const REVEAL_MS = REVEAL_SPIN_MS + 1500;

// Landing on an event space: the three events as cards, a highlight hopping between
// them that settles on the one that came up.
export function EventReveal({ show, onDone }: { show: RevealShow | null; onDone: () => void }) {
  const [lit, setLit] = useState(0);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!show) return;
    setLanded(false);
    const target = ORDER.indexOf(show.event);
    // end on the target after HOPS hops
    const start = (((target - HOPS) % ORDER.length) + ORDER.length) % ORDER.length;
    setLit(start);
    const timers: number[] = [];
    let at = 0;
    for (let i = 1; i <= HOPS; i++) {
      at += hopDelay(i - 1);
      const idx = (start + i) % ORDER.length;
      timers.push(window.setTimeout(() => setLit(idx), at));
    }
    timers.push(window.setTimeout(() => setLanded(true), at + 120));
    timers.push(window.setTimeout(onDone, REVEAL_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.key]);
  if (!show) return null;
  return (
    <div className="event-overlay" key={show.key}>
      <div className="event-panel">
        <div className="event-head">
          <BangIcon />
          <span>{show.mine ? "Event space!" : `${show.name} hit an event!`}</span>
        </div>
        <div className="event-cards">
          {ORDER.map((ev, i) => (
            <div key={ev} className={`event-card ${lit === i ? "lit" : ""} ${landed ? (lit === i ? "chosen" : "out") : ""}`}>
              <div className="event-card-icon">{ICONS[ev]}</div>
              <div className="event-card-name">{EVENT_NAMES[ev]}</div>
            </div>
          ))}
        </div>
        <div className={`event-result ${landed ? "on" : ""}`}>{landed ? <>It's <b>{EVENT_NAMES[show.event]}</b>!</> : " "}</div>
      </div>
    </div>
  );
}

const WHEEL_SPIN_MS = 2600;
export const WHEEL_MS = WHEEL_SPIN_MS + 1500;

// Coin Steal: a wheel of the possible percentages spins and lands on the rolled one.
export function StealWheel({ show, onDone }: { show: WheelShow | null; onDone: () => void }) {
  const [angle, setAngle] = useState(0);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!show) return;
    setLanded(false);
    setAngle(0);
    const n = show.percents.length;
    const i = Math.max(0, show.percents.indexOf(show.percent));
    // bring the middle of slice i to the pointer at the top, after a few full turns
    const target = 360 * 5 - (i + 0.5) * (360 / n);
    const go = window.setTimeout(() => setAngle(target), 60);
    const land = window.setTimeout(() => setLanded(true), WHEEL_SPIN_MS + 80);
    const done = window.setTimeout(onDone, WHEEL_MS);
    return () => [go, land, done].forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.key]);
  if (!show) return null;
  const n = show.percents.length;
  const R = 130;
  const slice = (j: number) => {
    const a0 = ((j * 360) / n - 90) * (Math.PI / 180);
    const a1 = (((j + 1) * 360) / n - 90) * (Math.PI / 180);
    return `M0 0 L${R * Math.cos(a0)} ${R * Math.sin(a0)} A${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`;
  };
  return (
    <div className="event-overlay" key={show.key}>
      <div className="event-panel wheel-panel">
        <div className="event-head">
          <CoinIcon />
          <span>Coin Steal</span>
        </div>
        <div className="wheel-sub">
          {show.mine ? "You're" : `${show.thief} is`} stealing from <b>{show.target}</b>
        </div>
        <div className="wheel-wrap">
          <svg className="wheel-pointer" viewBox="0 0 40 34" aria-hidden="true">
            <path d="M4 4h32L20 30z" fill="#2b2340" />
            <path d="M10 7h20L20 23z" fill="#fff8ec" />
          </svg>
          <svg className="wheel" viewBox="-140 -140 280 280" style={{ transform: `rotate(${angle}deg)`, transitionDuration: `${WHEEL_SPIN_MS}ms` }}>
            <circle r="136" fill="#2b2340" />
            {show.percents.map((p, j) => {
              const mid = (((j + 0.5) * 360) / n - 90) * (Math.PI / 180);
              return (
                <g key={j}>
                  <path d={slice(j)} fill={j % 2 ? "#fff8ec" : "#f2c230"} stroke="#2b2340" strokeWidth="4" strokeLinejoin="round" />
                  <text
                    x={R * 0.62 * Math.cos(mid)}
                    y={R * 0.62 * Math.sin(mid)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${((j + 0.5) * 360) / n} ${R * 0.62 * Math.cos(mid)} ${R * 0.62 * Math.sin(mid)})`}
                    className="wheel-label"
                  >
                    {p}%
                  </text>
                </g>
              );
            })}
            <circle r="20" fill="#fff8ec" stroke="#2b2340" strokeWidth="5" />
          </svg>
        </div>
        <div className={`event-result ${landed ? "on" : ""}`}>{landed ? <><b>{show.percent}%</b> of {show.target}'s coins!</> : " "}</div>
      </div>
    </div>
  );
}

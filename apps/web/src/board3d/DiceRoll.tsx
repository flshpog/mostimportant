import { useLayoutEffect, useRef, useState } from "react";
import { OutlineStarIcon } from "./Icons";
import { tokenColour } from "./Tokens";

export interface DiceShow {
  key: number;
  playerId: string;
  name: string;
  total: number;
  mine: boolean;
}

// The roll, in ms: the die drops in and tumbles to a stop facing you, the number
// fades in, it stays a moment, then it goes. Tokens start hopping after DICE_TOTAL_MS.
const FALL_MS = 520;
const SETTLE_MS = 1250; // spinning has eased to a stop by now
const REVEAL_MS = SETTLE_MS + 60;
const LEAVE_MS = 2350;
export const DICE_TOTAL_MS = 2650;

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;
// Resting pose: a slight angle so it still reads as a cube.
const REST = "rotateX(-14deg) rotateY(18deg)";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

// Height (px, negative is up) over time: fall like it's dropped, then two small bounces.
function heightAt(ms: number, drop: number): number {
  if (ms < FALL_MS) {
    const u = ms / FALL_MS;
    return -drop * (1 - u * u);
  }
  const bounces: [number, number][] = [
    [300, 64],
    [190, 18],
  ];
  let t = ms - FALL_MS;
  for (const [len, h] of bounces) {
    if (t < len) return -h * Math.sin((Math.PI * t) / len);
    t -= len;
  }
  return 0;
}

// A big die in the roller's colour drops from the top of the screen, tumbles, and
// settles facing you before the number fades in. Driven by requestAnimationFrame on
// one element (no React re-renders mid-flight), so it stays smooth.
export function DiceOverlay({ roll, onDone }: { roll: DiceShow | null; onDone: () => void }) {
  const dieRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<"rolling" | "revealed" | "leaving">("rolling");

  // layout effect: place the die off-screen before the first paint
  useLayoutEffect(() => {
    if (!roll) return;
    setStage("rolling");
    // a random tumble that eases out to exactly the resting pose
    const axis = [0.6 + Math.random() * 0.4, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5), (Math.random() - 0.5) * 0.4];
    const turns = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 0.6) * 360;
    const drop = Math.min(window.innerHeight * 0.65, 560);
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const ms = now - start;
      const spin = turns * (1 - easeOutCubic(Math.min(1, ms / SETTLE_MS)));
      const y = heightAt(ms, drop);
      // a quick squash where it hits the ground
      const impact = ms > FALL_MS && ms < FALL_MS + 120 ? Math.sin((Math.PI * (ms - FALL_MS)) / 120) : 0;
      if (dieRef.current) {
        dieRef.current.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${(1 + impact * 0.08).toFixed(3)}, ${(1 - impact * 0.1).toFixed(3)}) rotate3d(${axis.join(",")}, ${spin.toFixed(2)}deg) ${REST}`;
      }
      if (shadowRef.current) {
        const k = Math.max(0.25, 1 + y / drop);
        shadowRef.current.style.transform = `scale(${k.toFixed(3)})`;
        shadowRef.current.style.opacity = k.toFixed(3);
      }
      if (ms < SETTLE_MS + 50) raf = requestAnimationFrame(frame);
    };
    frame(start);
    const reveal = setTimeout(() => setStage("revealed"), REVEAL_MS);
    const leave = setTimeout(() => setStage("leaving"), LEAVE_MS);
    const done = setTimeout(onDone, DICE_TOTAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(reveal);
      clearTimeout(leave);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.key]);

  if (!roll) return null;
  const colour = tokenColour(roll.playerId);
  return (
    <div className={`dice-overlay ${stage}`} key={roll.key} aria-live="polite">
      <div className="dice-stage">
        <div className="dice-shadow" ref={shadowRef} />
        <div className="dice" ref={dieRef} style={{ ["--die" as string]: colour }}>
          {FACES.map((f) => (
            <div key={f} className={`dice-face ${f}`}>
              <OutlineStarIcon className="dice-mark" />
              {f === "front" && <span className="dice-number">{roll.total}</span>}
            </div>
          ))}
        </div>
        {stage !== "rolling" && <div className="dice-burst" style={{ ["--die" as string]: colour }} />}
      </div>
      <div className="dice-caption">
        {stage === "rolling" ? (
          <>{roll.mine ? "Rolling…" : `${roll.name} is rolling…`}</>
        ) : roll.mine ? (
          <>
            You rolled <b>{roll.total}</b>!
          </>
        ) : (
          <>
            {roll.name} rolled <b>{roll.total}</b>
          </>
        )}
      </div>
    </div>
  );
}

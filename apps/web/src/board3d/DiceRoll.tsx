import { useEffect, useState } from "react";
import { tokenColour } from "./Tokens";

export interface DiceShow {
  key: number;
  playerId: string;
  name: string;
  total: number;
  mine: boolean;
  min: number;
  max: number;
}

// How long the die tumbles before it lands. Token hops wait for this.
export const DICE_SPIN_MS = 1150;
// How long the whole overlay stays up.
export const DICE_SHOW_MS = 2700;

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

// A big tumbling die in the middle of the screen, in the roller's colour, that lands
// on the number and says who rolled it. Pure CSS 3D, so it costs the 3D scene nothing.
export function DiceOverlay({ roll, onDone }: { roll: DiceShow | null; onDone: () => void }) {
  const [faces, setFaces] = useState<number[]>([]);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (!roll) return;
    const rnd = () => roll.min + Math.floor(Math.random() * (roll.max - roll.min + 1));
    setLanded(false);
    setFaces(FACES.map(rnd));
    // flicker the faces while it tumbles, then settle on the real number
    const flicker = setInterval(() => setFaces(FACES.map(rnd)), 90);
    const land = setTimeout(() => {
      clearInterval(flicker);
      setFaces(FACES.map((_, i) => (i === 0 ? roll.total : rnd())));
      setLanded(true);
    }, DICE_SPIN_MS);
    const done = setTimeout(onDone, DICE_SHOW_MS);
    return () => {
      clearInterval(flicker);
      clearTimeout(land);
      clearTimeout(done);
    };
    // onDone is stable enough; restarting on it would replay the roll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.key]);

  if (!roll) return null;
  const colour = tokenColour(roll.playerId);
  return (
    <div className={`dice-overlay ${landed ? "landed" : ""}`} key={roll.key} aria-live="polite">
      <div className="dice-stage">
        <div className="dice-shadow" />
        <div className="dice" style={{ ["--die" as string]: colour }}>
          {FACES.map((f, i) => (
            <div key={f} className={`dice-face ${f}`}>
              {faces[i] ?? ""}
            </div>
          ))}
        </div>
        {landed && <div className="dice-burst" style={{ ["--die" as string]: colour }} />}
      </div>
      <div className="dice-caption">
        {landed ? (
          roll.mine ? (
            <>
              You rolled <b>{roll.total}</b>!
            </>
          ) : (
            <>
              {roll.name} rolled <b>{roll.total}</b>
            </>
          )
        ) : (
          <>{roll.mine ? "Rolling…" : `${roll.name} is rolling…`}</>
        )}
      </div>
    </div>
  );
}

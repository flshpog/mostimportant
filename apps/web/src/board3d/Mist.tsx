import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, DoubleSide, type Group } from "three";

// Purple mist drifting low over the underworld: big soft sprites lying flat, slowly
// circling the board at different speeds and heights.
export function Mist({ centre = [0, 0] as [number, number], radius = 16 }: { centre?: [number, number]; radius?: number }) {
  const ref = useRef<Group>(null);
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(190,140,255,0.55)");
    g.addColorStop(0.5, "rgba(150,90,230,0.22)");
    g.addColorStop(1, "rgba(120,60,200,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  }, []);
  const puffs = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        r: radius * (0.2 + ((i * 37) % 100) / 100) * 1.15,
        a: (i / 40) * Math.PI * 2 * 3.1,
        speed: (0.025 + ((i * 13) % 10) / 300) * (i % 2 ? 1 : -1),
        y: 0.4 + ((i * 7) % 10) / 10 * 1.6,
        size: 7 + ((i * 11) % 10) * 0.7,
      })),
    [radius],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.children.forEach((m, i) => {
      const p = puffs[i];
      const a = p.a + t * p.speed;
      m.position.set(centre[0] + Math.cos(a) * p.r, p.y + Math.sin(t * 0.4 + i) * 0.25, centre[1] + Math.sin(a) * p.r * 0.75);
      m.rotation.z = t * p.speed * 2 + i;
    });
  });
  return (
    <group ref={ref}>
      {puffs.map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <planeGeometry args={[p.size, p.size]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

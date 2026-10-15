import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, type Group, type Mesh } from "three";

function glowTexture(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

// A big pale moon low in the sky behind the board, with a soft halo. Unaffected by
// the fog, so it hangs there however far the camera pulls back.
export function Moon() {
  const halo = useMemo(() => glowTexture("rgba(225,215,255,0.55)", "rgba(170,140,255,0.18)"), []);
  return (
    <group position={[-38, 30, -78]}>
      <mesh>
        <sphereGeometry args={[6.5, 32, 20]} />
        <meshBasicMaterial color="#efe9ff" fog={false} />
      </mesh>
      <sprite scale={[46, 46, 1]}>
        <spriteMaterial map={halo} transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
    </group>
  );
}

// Will-o'-wisps: little glowing lights drifting low over the board on lazy loops,
// pulsing as they go. A couple carry a real light so they glow on the ground.
export function Wisps({ count = 14, radius = 14 }: { count?: number; radius?: number }) {
  const ref = useRef<Group>(null);
  const tex = useMemo(() => glowTexture("rgba(240,230,255,1)", "rgba(170,120,255,0.45)"), []);
  const green = useMemo(() => glowTexture("rgba(225,255,240,1)", "rgba(120,255,200,0.4)"), []);
  const wisps = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        r: radius * (0.25 + ((i * 53) % 100) / 100 * 0.85),
        a: (i / count) * Math.PI * 2 * 2.3,
        speed: (0.06 + ((i * 17) % 10) / 120) * (i % 2 ? 1 : -1),
        y: 0.7 + ((i * 7) % 10) / 10 * 1.8,
        wobble: 0.6 + ((i * 29) % 10) / 10,
        green: i % 5 === 0,
        light: i % 6 === 0,
      })),
    [count, radius],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.children.forEach((w, i) => {
      const p = wisps[i];
      const a = p.a + t * p.speed;
      w.position.set(
        Math.cos(a) * p.r + Math.sin(t * 0.7 + i) * p.wobble,
        p.y + Math.sin(t * 1.3 + i * 2) * 0.35,
        Math.sin(a) * p.r * 0.75 + Math.cos(t * 0.5 + i) * p.wobble,
      );
      const pulse = 0.75 + Math.sin(t * 2.2 + i * 1.7) * 0.25;
      w.scale.setScalar(pulse);
      const glow = w.children[0] as Mesh | undefined;
      if (glow && "material" in glow) (glow.material as { opacity: number }).opacity = 0.6 + pulse * 0.4;
    });
  });
  return (
    <group ref={ref}>
      {wisps.map((w, i) => (
        <group key={i}>
          <sprite scale={[1.3, 1.3, 1]}>
            <spriteMaterial map={w.green ? green : tex} transparent depthWrite={false} blending={AdditiveBlending} />
          </sprite>
          {w.light && <pointLight color={w.green ? "#9dffd2" : "#c7a6ff"} intensity={5} distance={6} decay={2} />}
        </group>
      ))}
    </group>
  );
}

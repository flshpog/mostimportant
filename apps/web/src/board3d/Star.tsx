import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ExtrudeGeometry, Shape, type Group } from "three";

function starGeometry() {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.26 : 0.6;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 });
  g.center();
  return g;
}

// The star floats and turns above its space, glowing.
export function Star({ position }: { position: [number, number, number] }) {
  const ref = useRef<Group>(null);
  const geometry = useMemo(starGeometry, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 1.2;
    ref.current.position.y = position[1] + 1.35 + Math.sin(t * 2) * 0.12;
  });
  return (
    <group ref={ref} position={[position[0], position[1] + 1.35, position[2]]}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.55} roughness={0.25} metalness={0.1} />
      </mesh>
      <pointLight color="#ffd86b" intensity={6} distance={5} decay={2} />
    </group>
  );
}

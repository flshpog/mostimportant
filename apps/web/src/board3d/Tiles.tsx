import { useMemo } from "react";
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial } from "three";
import { loadSeasonConfig, type Board, type SpaceType } from "@everest/board-data";
import { spaceToWorld } from "./coords";

// Same look as the Blender tiles: a cream base with a coloured, slightly domed top.
export const TILE_COLOURS: Record<SpaceType, string> = {
  blue: "#2f7de1",
  red: "#e5484d",
  green: "#3fb950",
  shop: "#8e4ec6",
  event: "#f2c230",
  start: "#f5a524",
};

export function Tiles({ layout }: { layout: Board }) {
  const { base, top } = useMemo(() => {
    const n = layout.spaces.length;
    const baseGeo = new CylinderGeometry(0.56, 0.6, 0.16, 14);
    baseGeo.translate(0, 0.08, 0);
    const topGeo = new CylinderGeometry(0.42, 0.47, 0.12, 14);
    topGeo.translate(0, 0.21, 0);
    const base = new InstancedMesh(baseGeo, new MeshStandardMaterial({ color: "#fff6e2", roughness: 0.5, flatShading: true }), n);
    const top = new InstancedMesh(topGeo, new MeshStandardMaterial({ roughness: 0.35, flatShading: true }), n);
    const m = new Matrix4();
    layout.spaces.forEach((s, i) => {
      const p = spaceToWorld(layout, s.id);
      m.makeRotationY((i * 2.399) % (Math.PI * 2)); // a little variety in the facets
      m.setPosition(p);
      base.setMatrixAt(i, m);
      top.setMatrixAt(i, m);
      // shops take their variant's colour (purple, pink)
      const variant = s.shop ? loadSeasonConfig().shop.variants[s.shop]?.colour : undefined;
      top.setColorAt(i, new Color(variant ?? TILE_COLOURS[s.type]));
    });
    for (const mesh of [base, top]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (top.instanceColor) top.instanceColor.needsUpdate = true;
    return { base, top };
  }, [layout]);
  return (
    <group>
      <primitive object={base} />
      <primitive object={top} />
    </group>
  );
}

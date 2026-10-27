// 철근 노출: 구조재(기둥·보·슬래브) 사이 끊긴 연결에서 짧은 철근 몇 가닥이 튀어나온다.
// 한쪽이 떨어져 나갔거나 두 조각 사이 틈이 rebarMinGap보다 벌어진 곳에만. InstancedMesh 1개(드로우콜 1).
// 손상이 바뀔 때만 다시 배치한다 (매 프레임 아님).
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { DAMAGE_VISUAL } from '../config';
import type { DestructionSystem } from '../destruction/DestructionSystem';
import { MATERIAL } from '../fracture/Fragment';
import { XRAY_HIDE } from './XRayView';

/** 끊긴 연결 하나에 놓는 가닥 수와 가닥 사이 간격 (m) */
const RODS_PER_EDGE = 2;
const ROD_SPACING = 0.16;
const Y = new Vector3(0, 1, 0);

const a = new Vector3();
const b = new Vector3();
const dir = new Vector3();
const side = new Vector3();
const origin = new Vector3();
const scale = new Vector3();
const q = new Quaternion();
const m = new Matrix4();

export class Rebar {
  readonly mesh: InstancedMesh;

  constructor(scene: Scene) {
    const geo = new CylinderGeometry(1, 1, 1, 5);
    geo.translate(0, 0.5, 0); // 밑동이 원점, +y로 뻗는다
    this.mesh = new InstancedMesh(
      geo,
      new MeshStandardMaterial({
        color: DAMAGE_VISUAL.rebarColor,
        metalness: 0.6,
        roughness: 0.7,
      }),
      DAMAGE_VISUAL.rebarMax,
    );
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData[XRAY_HIDE] = true;
    scene.add(this.mesh);
  }

  /** offsets: 서 있는 조각의 손상 자세 이동 (DamageView.offsets) */
  rebuild(system: DestructionSystem, offsets: Float32Array): void {
    const g = system.graph;
    const p = system.positions;
    const frags = system.fragments.fragments;
    const max = DAMAGE_VISUAL.rebarMax;
    let count = 0;
    const structural = (i: number) => !g.cladding[i] && frags[i]!.material === MATERIAL.concrete;
    for (let e = 0; e < g.edgeCount && count + RODS_PER_EDGE <= max; e++) {
      if (g.alive[e]) continue;
      const i = g.edgeA[e]!;
      const j = g.edgeB[e]!;
      if (!structural(i) || !structural(j)) continue;
      const ai = g.attached[i] === 1;
      const aj = g.attached[j] === 1;
      if (!ai && !aj) continue;
      // 서 있는 쪽 s에서 반대쪽으로 튀어나온다
      const s = ai ? i : j;
      const t = s === i ? j : i;
      a.set(p[s * 3]!, p[s * 3 + 1]!, p[s * 3 + 2]!);
      b.set(p[t * 3]!, p[t * 3 + 1]!, p[t * 3 + 2]!);
      if (ai && aj) {
        // 둘 다 서 있으면 틈이 충분히 벌어진 곳만
        const gap =
          Math.hypot(
            b.x + offsets[t * 3]! - a.x - offsets[s * 3]!,
            b.y + offsets[t * 3 + 1]! - a.y - offsets[s * 3 + 1]!,
            b.z + offsets[t * 3 + 2]! - a.z - offsets[s * 3 + 2]!,
          ) - a.distanceTo(b);
        if (gap < DAMAGE_VISUAL.rebarMinGap) continue;
      }
      dir.subVectors(b, a).normalize();
      origin.addVectors(a, b).multiplyScalar(0.5);
      origin.x += offsets[s * 3]!;
      origin.y += offsets[s * 3 + 1]!;
      origin.z += offsets[s * 3 + 2]!;
      side.crossVectors(dir, Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : Y).normalize();
      for (let k = 0; k < RODS_PER_EDGE; k++) {
        // 엣지 번호로 정해지는 약간의 길이·각도 변주 (매번 같은 모양)
        const h = Math.sin(e * 12.9898 + k * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        const len = DAMAGE_VISUAL.rebarLength * (0.6 + 0.4 * r);
        const rod = dir
          .clone()
          .addScaledVector(side, (r - 0.5) * 0.4)
          .normalize();
        q.setFromUnitVectors(Y, rod);
        const at = origin
          .clone()
          .addScaledVector(side, (k - (RODS_PER_EDGE - 1) / 2) * ROD_SPACING);
        at.addScaledVector(rod, -0.08); // 콘크리트 속에서 시작
        scale.set(DAMAGE_VISUAL.rebarRadius, len, DAMAGE_VISUAL.rebarRadius);
        this.mesh.setMatrixAt(count++, m.compose(at, q, scale));
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
  }
}

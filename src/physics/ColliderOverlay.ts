// 디버그: Rapier 콜라이더 와이어프레임을 렌더 위에 겹쳐 본다 (world.debugRender).
// 불변 조건을 어긴 조각(콜라이더 없음 / 굳었는데 발사체가 못 맞힘 / 물리 없이 떨어짐 / 렌더와 어긋남)은
// 빨간 상자로 표시한다. 무거우니 colliderOverlaySec마다만 갱신한다.
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  type Scene,
} from 'three';
import { DAMAGE_VISUAL } from '../config';
import { checkInvariants, type InvariantReport } from '../destruction/Invariants';
import type { DestructionSystem } from '../destruction/DestructionSystem';
import type { PhysicsWorld } from './PhysicsWorld';

/** 빨간 상자 하나 = 모서리 12개 = 정점 24개 */
const BOX_VERTICES = 24;
const CORNERS = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

export class ColliderOverlay {
  private readonly wire: LineSegments;
  private readonly marks: LineSegments;
  private enabled = false;
  private acc = Infinity;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.wire = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
      }),
    );
    this.marks = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0xff2020, depthTest: false }),
    );
    for (const l of [this.wire, this.marks]) {
      l.frustumCulled = false;
      l.renderOrder = 5;
      l.visible = false;
      scene.add(l);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.wire.visible = on;
    this.marks.visible = on;
    this.acc = Infinity; // 켜자마자 갱신
  }

  /** 렌더 프레임마다 (실제 시간). 켜져 있을 때만 일한다. 반환: 이번에 검사했으면 그 결과 */
  update(dt: number, system: DestructionSystem | null): InvariantReport | null {
    if (!this.enabled) return null;
    this.acc += dt;
    if (this.acc < DAMAGE_VISUAL.colliderOverlaySec) return null;
    this.acc = 0;
    const { vertices, colors } = this.physics.world.debugRender();
    const g = this.wire.geometry;
    g.setAttribute('position', new BufferAttribute(vertices.slice(), 3));
    g.setAttribute('color', new BufferAttribute(colors.slice(), 4));
    if (!system) return null;
    const report = checkInvariants(system);
    this.drawMarks(system, [
      ...report.noCollider,
      ...report.unhittable,
      ...report.stranded,
      ...report.misaligned,
    ]);
    return report;
  }

  private drawMarks(system: DestructionSystem, nodes: readonly number[]): void {
    const out = new Float32Array(nodes.length * BOX_VERTICES * 3);
    let v = 0;
    for (const i of nodes) {
      const f = system.fragments.fragments[i]!;
      const chunk = system.fragments.chunkOf[i];
      const h = Math.cbrt(f.volume) * 0.6 + 0.05;
      const c = chunk
        ? chunk.offsets[chunk.frags.indexOf(i)]!.clone()
            .applyQuaternion(chunk.body.currQuat)
            .add(chunk.body.currPos)
        : f.centroid;
      for (const [s, t] of CORNERS) {
        for (const k of [s, t]) {
          out[v++] = c.x + (k & 1 ? h : -h);
          out[v++] = c.y + (k & 2 ? h : -h);
          out[v++] = c.z + (k & 4 ? h : -h);
        }
      }
    }
    this.marks.geometry.setAttribute('position', new BufferAttribute(out, 3));
  }
}

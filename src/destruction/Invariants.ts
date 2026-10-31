// 파괴 시스템 불변 조건 검사 (디버그 GUI 주기 검사 + 단위 테스트):
//   1) 보이는 조각은 콜라이더가 있고, 굳어 있으면(fixed) 발사체와 부딪힌다
//      (움직이는 잔해만 발사체를 통과시킨다)
//   2) 구조에서 떨어진 조각은 한 번은 dynamic이 됐어야 한다 — 그래프에서만 떼고 물리는 그대로 둔
//      '서 있는 척하는' 조각이 없어야 한다
//   3) fixed 조각의 렌더 위치와 콜라이더(바디) 위치 오차가 maxRenderError 이하
import { Matrix4, Vector3 } from 'three';
import { DAMAGE_VISUAL } from '../config';
import { groupsInteract, PROJECTILE_GROUPS } from '../physics/collisionGroups';
import type { DestructionSystem } from './DestructionSystem';

export interface InvariantReport {
  /** 보이는데 콜라이더가 없거나 꺼진 조각 */
  noCollider: number[];
  /** 굳어 있는데 발사체가 못 맞히는 조각 */
  unhittable: number[];
  /** 그래프에서 떨어졌는데 한 번도 dynamic이 안 된 조각 */
  stranded: number[];
  /** 렌더↔콜라이더 오차가 허용치를 넘는 조각 */
  misaligned: number[];
  /** 최대 렌더↔콜라이더 오차 (m) */
  maxRenderError: number;
}

const matrix = new Matrix4();
const rendered = new Vector3();
const expected = new Vector3();

export function violationCount(r: InvariantReport): number {
  return r.noCollider.length + r.unhittable.length + r.stranded.length + r.misaligned.length;
}

export function checkInvariants(system: DestructionSystem): InvariantReport {
  const report: InvariantReport = {
    noCollider: [],
    unhittable: [],
    stranded: [],
    misaligned: [],
    maxRenderError: 0,
  };
  const { fragments, graph } = system;
  for (let i = 0; i < graph.nodeCount; i++) {
    const chunk = fragments.chunkOf[i];
    if (!chunk) continue; // 제거됨 (안 보임)
    const body = chunk.body;
    if (!body.alive || body.colliders.length === 0 || body.colliders.some((c) => !c.isEnabled())) {
      report.noCollider.push(i);
      continue;
    }
    const fixed = body.rigidBody.isFixed();
    if (
      fixed &&
      !body.colliders.every((c) => groupsInteract(c.collisionGroups(), PROJECTILE_GROUPS))
    ) {
      report.unhittable.push(i);
    }
    if (!graph.attached[i] && !system.everDynamic[i]) report.stranded.push(i);
    // 움직이는 바디는 렌더 보간 중, dirty는 방금 굳어 아직 렌더에 반영 전 (다음 sync에서 맞춰진다)
    if (!fixed || body.dirty) continue;
    const slot = fragments.meshes.slots[i]![0];
    if (!slot) continue;
    slot.batch.getMatrixAt(slot.id, matrix);
    rendered.setFromMatrixPosition(matrix);
    const k = chunk.frags.indexOf(i);
    expected.copy(chunk.offsets[k]!).applyQuaternion(body.currQuat).add(body.currPos);
    const err = rendered.distanceTo(expected);
    report.maxRenderError = Math.max(report.maxRenderError, err);
    if (err > DAMAGE_VISUAL.maxRenderError) report.misaligned.push(i);
  }
  return report;
}

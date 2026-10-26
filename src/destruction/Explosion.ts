// 충돌 지점 기반 엣지 파괴 + 거리 감쇠 임펄스
// - blastRadius: 운동에너지(J) → 파괴 반경
// - breakInBlast: 반경 안 구조 엣지를 끊고, 코어 안 조각과 거의 다 끊긴 조각은 구조에서 떼어낸다
//   (그래프만 바꾼다)
// - applyExplosion: dynamic 바디에 거리 감쇠 임펄스
import { Vector3 } from 'three';
import { EXPLOSION, STRUCTURE } from '../config';
import type { StructureGraph } from '../building/StructureGraph';
import type { Vec3Like } from '../fracture/polyhedron';
import type { PhysicsBody } from '../physics/PhysicsWorld';

export interface ExplosionOptions {
  radius?: number;
  /** 폭심에서 얻는 속도 변화 (m/s) */
  peakDeltaV?: number;
  falloffExponent?: number;
  /** 무작위 회전용 난수 [0, 1). 테스트에서 고정하려고 주입 가능. */
  random?: () => number;
}

const dir = new Vector3();
const impulse = new Vector3();
const torque = new Vector3();

/**
 * center에서 radius 안의 동적 바디를 바깥으로 밀어낸다.
 * 임펄스 = 질량 × peakDeltaV × (1 - 거리/radius)^falloffExponent → 질량과 무관하게 같은 속도 변화.
 * 반환값: 임펄스를 받은 바디 수
 */
export function applyExplosion(
  bodies: Iterable<PhysicsBody>,
  center: Vec3Like,
  options: ExplosionOptions = {},
): number {
  const radius = options.radius ?? EXPLOSION.radius;
  const peak = options.peakDeltaV ?? EXPLOSION.peakDeltaV;
  const exponent = options.falloffExponent ?? EXPLOSION.falloffExponent;
  const random = options.random ?? Math.random;

  let hit = 0;
  for (const body of bodies) {
    if (!body.alive) continue;
    const rb = body.rigidBody;
    if (!rb.isDynamic()) continue;
    dir.copy(body.currPos).sub(center);
    const dist = dir.length();
    if (dist > radius) continue;

    const falloff = Math.pow(1 - dist / radius, exponent);
    if (dist > 1e-6) dir.divideScalar(dist);
    else dir.set(0, 1, 0);
    dir.y += EXPLOSION.upwardBias;
    dir.normalize();

    const mass = rb.mass();
    impulse.copy(dir).multiplyScalar(mass * peak * falloff);
    rb.applyImpulse(impulse, true);

    // 회전 임펄스 = 관성 × 원하는 각속도 변화 (주축 프레임 차이는 무시: 연출용 무작위 회전)
    const inertia = rb.principalInertia();
    const spin = 2 * EXPLOSION.spin * falloff;
    torque.set(
      inertia.x * (random() - 0.5) * spin,
      inertia.y * (random() - 0.5) * spin,
      inertia.z * (random() - 0.5) * spin,
    );
    rb.applyTorqueImpulse(torque, true);
    hit++;
  }
  return hit;
}

/** 운동에너지(J) → 파괴 반경 (m). 에너지의 세제곱근에 비례 (폭발 부피 ∝ 에너지). */
export function blastRadius(energy: number): number {
  const r = EXPLOSION.radiusPerCubeRootJoule * Math.cbrt(Math.max(energy, 0));
  return Math.min(Math.max(r, EXPLOSION.minRadius), EXPLOSION.maxRadius);
}

/**
 * 서 있는 구조에 폭발을 적용한다 (그래프만 바꾼다, 물리 전환은 호출 쪽).
 * - 중점이 반경 안인 엣지는 끊는다
 * - 질량중심이 코어(반경 × coreFraction) 안인 조각은 구조에서 떼어낸다
 * - 반경 × rubbleRange 안에서 처음 연결 면적의 rubbleFraction도 안 남은 조각(거의 다 부서져
 *   간신히 매달린 조각)도 떼어낸다. 여러 번 맞은 자리에 너덜너덜한 잔재가 남지 않게.
 * positions: 노드 질량중심 xyz 평탄화 (서 있는 노드는 움직이지 않으므로 원래 위치)
 * 반환: 떼어낸 노드
 */
export function breakInBlast(
  graph: StructureGraph,
  positions: ArrayLike<number>,
  center: Vec3Like,
  radius: number,
): number[] {
  const r2 = radius * radius;
  const core = radius * EXPLOSION.coreFraction;
  const core2 = core * core;
  const dist2 = (x: number, y: number, z: number) =>
    (x - center.x) ** 2 + (y - center.y) ** 2 + (z - center.z) ** 2;

  for (let e = 0; e < graph.edgeCount; e++) {
    if (!graph.alive[e]) continue;
    const a = graph.edgeA[e]! * 3;
    const b = graph.edgeB[e]! * 3;
    if (!graph.attached[a / 3] || !graph.attached[b / 3]) continue;
    const mx = (positions[a]! + positions[b]!) / 2;
    const my = (positions[a + 1]! + positions[b + 1]!) / 2;
    const mz = (positions[a + 2]! + positions[b + 2]!) / 2;
    if (dist2(mx, my, mz) <= r2) graph.breakEdge(e);
  }

  const detached: number[] = [];
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!graph.attached[i]) continue;
    const p = i * 3;
    if (dist2(positions[p]!, positions[p + 1]!, positions[p + 2]!) <= core2 && graph.detach(i)) {
      detached.push(i);
    }
  }

  const rubble = radius * STRUCTURE.rubbleRange;
  const rubble2 = rubble * rubble;
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!graph.attached[i] || graph.anchor[i]) continue;
    const p = i * 3;
    if (dist2(positions[p]!, positions[p + 1]!, positions[p + 2]!) > rubble2) continue;
    if (graph.remainingAreaFraction(i) < STRUCTURE.rubbleFraction && graph.detach(i)) {
      detached.push(i);
    }
  }
  return detached;
}

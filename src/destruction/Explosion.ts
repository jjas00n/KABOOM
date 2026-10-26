// 충돌 지점 기반 엣지 파괴 + 거리 감쇠 임펄스
// Phase 2: 거리 감쇠 방사 임펄스만. 엣지 파괴/운동에너지 기반 세기는 Phase 4.
import { Vector3 } from 'three';
import { EXPLOSION } from '../config';
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

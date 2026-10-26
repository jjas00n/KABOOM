// 포탄 궤적과 조준 각도 계산 (순수 함수, three/Rapier 의존 없음)
// 궤적은 Rapier와 똑같이 적분한다: 고정 timestep을 solverIterations개 서브스텝으로 나눠
// 서브스텝마다 semi-implicit Euler(v += g·h → x += v·h). Rapier는 솔버 반복 수만큼 서브스텝을 돈다.
// 그래야 조준 화면의 예상 궤적 점선이 실제로 날아가는 경로와 겹친다 (안 맞추면 3초에 12cm 어긋남).
import { CANNON, PHYSICS } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';

/** maxSec 동안 stepSec 간격 궤적에 필요한 최대 점 수 (버퍼 크기용) */
export function trajectoryCapacity(stepSec: number, maxSec: number): number {
  return Math.ceil(maxSec / stepSec) + 2;
}

/**
 * origin에서 velocity로 쏜 포탄의 경로 점들을 out(xyz 평탄화)에 쓴다. 반환: 점 개수.
 * stepSec마다 하나씩, maxSec까지 또는 groundY 아래로 내려갈 때까지 (마지막 점은 지면 교차점).
 * out이 모자라면 거기서 멈춘다. 매 프레임 불러도 할당이 없다.
 */
export function simulateTrajectory(
  origin: Vec3Like,
  velocity: Vec3Like,
  stepSec: number,
  maxSec: number,
  out: Float32Array,
  groundY = 0,
  dt: number = PHYSICS.fixedTimestep,
  gravityY: number = PHYSICS.gravity.y,
  substeps: number = PHYSICS.solverIterations,
): number {
  const capacity = Math.floor(out.length / 3);
  if (capacity === 0) return 0;
  let x = origin.x;
  let y = origin.y;
  let z = origin.z;
  let vy = velocity.y;
  const { x: vx, z: vz } = velocity;
  let n = put(out, 0, x, y, z);
  const stepsPerSample = Math.max(1, Math.round(stepSec / dt));
  const totalSteps = Math.ceil(maxSec / dt);
  const h = dt / substeps;
  for (let i = 1; i <= totalSteps && n < capacity; i++) {
    const px = x;
    const py = y;
    const pz = z;
    for (let s = 0; s < substeps; s++) {
      vy += gravityY * h;
      y += vy * h;
    }
    x += vx * dt;
    z += vz * dt;
    if (y < groundY) {
      const t = (py - groundY) / (py - y);
      n = put(out, n, px + (x - px) * t, groundY, pz + (z - pz) * t);
      break;
    }
    if (i % stepsPerSample === 0) n = put(out, n, x, y, z);
  }
  return n;
}

/** n번째 점에 쓰고 다음 인덱스를 돌려준다 */
function put(out: Float32Array, n: number, x: number, y: number, z: number): number {
  out[n * 3] = x;
  out[n * 3 + 1] = y;
  out[n * 3 + 2] = z;
  return n + 1;
}

/** 조준 각도를 대포 제한 안으로 */
export function clampAim(yaw: number, pitch: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.min(Math.max(yaw, -CANNON.yawLimit), CANNON.yawLimit),
    pitch: Math.min(Math.max(pitch, CANNON.pitchMin), CANNON.pitchMax),
  };
}

/** 파워(0~1) → 포구 속도 (m/s) */
export function muzzleSpeed(power: number, min: number, max: number): number {
  const p = Math.min(Math.max(power, 0), 1);
  return min + (max - min) * p;
}

/**
 * 대포 조준 방향 (단위 벡터). baseYaw = 대포가 기본으로 바라보는 방위각(+z 기준, y축 회전),
 * yaw/pitch = 거기서의 조준 각도. three의 rotation.y → rotation.x(-pitch) 순서와 같다.
 */
export function aimDirection(
  baseYaw: number,
  yaw: number,
  pitch: number,
  out: { x: number; y: number; z: number },
): void {
  const a = baseYaw + yaw;
  const c = Math.cos(pitch);
  out.x = Math.sin(a) * c;
  out.y = Math.sin(pitch);
  out.z = Math.cos(a) * c;
}

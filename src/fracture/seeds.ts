// 시드 생성: 균일 랜덤, 지터 그리드, 적응형 밀집
// 모든 함수는 xyz 평탄화 Float64Array를 반환하고, 같은 rng 시드면 같은 결과(결정적)를 낸다.
import { FRACTURE } from '../config';
import type { Aabb, Vec3Like } from './polyhedron';

export type Rng = () => number;

/** mulberry32: 작고 빠른 시드 고정 PRNG, [0, 1) */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniformSeeds(bounds: Aabb, count: number, rng: Rng): Float64Array {
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) randomPoint(bounds, rng, out, i * 3);
  return out;
}

/**
 * 박스를 약 count개의 정육면체에 가까운 칸으로 나누고 칸마다 시드 1개를 흔들어 놓는다.
 * 균일 랜덤보다 조각 크기가 고르다. 실제 개수는 칸 분할에 따라 count와 조금 다를 수 있다.
 */
export function jitteredGridSeeds(
  bounds: Aabb,
  count: number,
  rng: Rng,
  jitter: number = FRACTURE.jitter,
): Float64Array {
  const sx = bounds.max.x - bounds.min.x;
  const sy = bounds.max.y - bounds.min.y;
  const sz = bounds.max.z - bounds.min.z;
  const h = Math.cbrt((sx * sy * sz) / Math.max(count, 1));
  const nx = Math.max(1, Math.round(sx / h));
  const ny = Math.max(1, Math.round(sy / h));
  const nz = Math.max(1, Math.round(sz / h));
  const cx = sx / nx;
  const cy = sy / ny;
  const cz = sz / nz;

  const out = new Float64Array(nx * ny * nz * 3);
  let o = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        out[o++] = bounds.min.x + (ix + 0.5 + (rng() - 0.5) * jitter) * cx;
        out[o++] = bounds.min.y + (iy + 0.5 + (rng() - 0.5) * jitter) * cy;
        out[o++] = bounds.min.z + (iz + 0.5 + (rng() - 0.5) * jitter) * cz;
      }
    }
  }
  return out;
}

/**
 * focus 주변으로 밀집된 시드. 밀도 = 1 + (multiplier - 1)·max(0, 1 - 거리/radius)
 * (중심에서 multiplier배, 반경 밖에서 1배). 기각 샘플링으로 뽑는다.
 */
export function adaptiveSeeds(
  bounds: Aabb,
  count: number,
  focus: Vec3Like,
  rng: Rng,
  radius: number = FRACTURE.adaptiveSeedRadius,
  multiplier: number = FRACTURE.adaptiveSeedMultiplier,
): Float64Array {
  const out = new Float64Array(count * 3);
  const maxAttempts = count * FRACTURE.adaptiveMaxAttempts;
  let made = 0;
  for (let attempt = 0; made < count && attempt < maxAttempts; attempt++) {
    const o = made * 3;
    randomPoint(bounds, rng, out, o);
    const dist = Math.hypot(out[o]! - focus.x, out[o + 1]! - focus.y, out[o + 2]! - focus.z);
    const density = 1 + (multiplier - 1) * Math.max(0, 1 - dist / radius);
    if (rng() * multiplier <= density) made++;
  }
  // 시도 횟수를 다 쓰면(사실상 없음) 나머지는 균일로 채운다
  for (; made < count; made++) randomPoint(bounds, rng, out, made * 3);
  return out;
}

function randomPoint(b: Aabb, rng: Rng, out: Float64Array, o: number): void {
  out[o] = b.min.x + rng() * (b.max.x - b.min.x);
  out[o + 1] = b.min.y + rng() * (b.max.y - b.min.y);
  out[o + 2] = b.min.z + rng() * (b.max.z - b.min.z);
}

// 부재별 조각 수 배분: 부피 × 부재 종류 밀도에 비례, 합계가 품질 프리셋 목표에 맞도록 스케일
import { FRACTURE, QUALITY_PRESETS, type QualityPreset } from '../config';
import { jitteredGridSeeds, type Rng } from '../fracture/seeds';
import { boxVolume, type Member } from './Member';

const SCALE_SEARCH_STEPS = 50;

/**
 * 부재별 조각 수 = max(1, round(부피 × 밀도 × s)). 합이 목표에 가장 가까운 s를 이분 탐색한다.
 * (최소 1개 = 안 쪼개진 박스. 부재 수보다 목표가 작으면 전부 1개.)
 * 공통 배수 s 하나만 쓰므로 부재 종류 간 밀도 비율이 그대로 유지된다.
 */
export function allocateSeeds(members: readonly Member[], targetFragments: number): number[] {
  const weights = members.map((m) => boxVolume(m.box) * FRACTURE.seedDensity[m.kind]);
  const counts = (s: number) => weights.map((w) => Math.max(1, Math.round(w * s)));
  const sum = (s: number) => counts(s).reduce((a, n) => a + n, 0);

  let lo = 0;
  let hi = targetFragments / Math.max(Math.min(...weights.filter((w) => w > 0)), 1e-12);
  for (let i = 0; i < SCALE_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) < targetFragments) lo = mid;
    else hi = mid;
  }
  return counts(
    Math.abs(sum(lo) - targetFragments) <= Math.abs(sum(hi) - targetFragments) ? lo : hi,
  );
}

export function seedCountsForPreset(members: readonly Member[], preset: QualityPreset): number[] {
  return allocateSeeds(members, QUALITY_PRESETS[preset].targetFragments);
}

/**
 * 부재 하나의 시드. 지터 그리드라 조각 크기가 고르다.
 * 시드가 1개면 박스 중심(분할 없이 통짜 조각).
 */
export function memberSeeds(member: Member, count: number, rng: Rng): Float64Array {
  const { min, max } = member.box;
  if (count <= 1) {
    return Float64Array.of((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  }
  return jitteredGridSeeds(member.box, count, rng);
}

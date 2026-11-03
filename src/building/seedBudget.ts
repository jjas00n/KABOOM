// 부재별 조각 수 배분: 부피 × 부재 종류 밀도에 비례, 합계가 품질 프리셋 목표에 맞도록 스케일
import { FRACTURE, ORDERS, QUALITY_PRESETS, type QualityPreset } from '../config';
import { containsPoint } from '../fracture/polyhedron';
import { jitteredGridSeeds, type Rng } from '../fracture/seeds';
import { boxVolume, isConvexMember, memberPolyhedron, memberVolume, type Member } from './Member';

const SCALE_SEARCH_STEPS = 50;

/**
 * 부재별 조각 수 = max(1, round(부피 × 밀도 × s)). 합이 목표에 가장 가까운 s를 이분 탐색한다.
 * (최소 1개 = 안 쪼개진 박스. 부재 수보다 목표가 작으면 전부 1개.)
 * 공통 배수 s 하나만 쓰므로 부재 종류 간 밀도 비율이 그대로 유지된다.
 */
export function allocateSeeds(members: readonly Member[], targetFragments: number): number[] {
  const weights = members.map((m) => memberVolume(m) * FRACTURE.seedDensity[m.kind]);
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

/** 품질 프리셋 목표 × 주문 예산 배율 (상한 ORDERS.maxFragments) */
export function targetFragments(preset: QualityPreset, budgetScale = 1): number {
  return Math.min(
    Math.round(QUALITY_PRESETS[preset].targetFragments * budgetScale),
    ORDERS.maxFragments,
  );
}

export function seedCountsForPreset(
  members: readonly Member[],
  preset: QualityPreset,
  budgetScale = 1,
): number[] {
  return allocateSeeds(members, targetFragments(preset, budgetScale));
}

/**
 * 부재 하나의 시드. 지터 그리드라 조각 크기가 고르다.
 * 시드가 1개면 중심(분할 없이 통짜 조각).
 * 볼록 부재: 바운딩 박스 칸을 부피 비만큼 늘려 깐 뒤 모양 안 시드만 남긴다.
 * 나뭇결(grain): 그 축 칸을 길게 → 길쭉한 조각.
 */
export function memberSeeds(member: Member, count: number, rng: Rng): Float64Array {
  const { min, max } = member.box;
  const stretch: [number, number, number] = [1, 1, 1];
  if (member.grain) stretch[member.grain.axis] = member.grain.stretch;
  if (!isConvexMember(member)) {
    if (count <= 1) {
      return Float64Array.of((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    }
    return member.grain
      ? jitteredGridSeeds(member.box, count, rng, undefined, stretch)
      : jitteredGridSeeds(member.box, count, rng);
  }
  const poly = memberPolyhedron(member);
  const center = () => {
    // 꼭짓점 평균 (볼록이라 안쪽)
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const f of poly.faces) {
      for (let k = 0; k < f.verts.length; k += 3) {
        x += f.verts[k]!;
        y += f.verts[k + 1]!;
        z += f.verts[k + 2]!;
        n++;
      }
    }
    return Float64Array.of(x / n, y / n, z / n);
  };
  if (count <= 1) return center();
  const fill = boxVolume(member.box) / Math.max(memberVolume(member), 1e-9);
  const grid = jitteredGridSeeds(member.box, Math.round(count * fill), rng, undefined, stretch);
  const inside: number[] = [];
  for (let k = 0; k < grid.length; k += 3) {
    if (containsPoint(poly, grid[k]!, grid[k + 1]!, grid[k + 2]!)) {
      inside.push(grid[k]!, grid[k + 1]!, grid[k + 2]!);
    }
  }
  return inside.length > 0 ? Float64Array.from(inside) : center();
}

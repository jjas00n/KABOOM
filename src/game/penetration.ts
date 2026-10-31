// 관통: 강한 포탄은 맞은 면 뒤로 파고들며 경로를 따라 추가 폭발을 일으킨다 (순수 함수)
import { PENETRATION } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';

export interface Blast {
  point: { x: number; y: number; z: number };
  /** 폭발 에너지 (J) */
  energy: number;
  /** 첫 충돌 뒤 몇 초(물리 시간) 뒤에 터지는지 = 거리 / 속도 */
  delay: number;
}

/**
 * 에너지(J)로 파고드는 깊이 (m). resistance: 저항 배율 (1 = 멀쩡한 콘크리트,
 * 이미 부서진 곳은 작다 → 같은 에너지로 더 깊이)
 */
export function penetrationDepth(energy: number, resistance = 1): number {
  const r = Math.max(resistance, 0.05);
  const excess = energy - PENETRATION.minEnergy * r; // 부서진 곳은 뚫기 시작하는 문턱도 낮다
  const perMeter = PENETRATION.energyPerMeter * r;
  return excess > 0 ? Math.min(excess / perMeter, PENETRATION.maxDepth) : 0;
}

/**
 * 충돌 지점 point에서 dir(단위 벡터) 방향으로 speed(m/s)로 파고드는 포탄의 폭발 목록.
 * - 관통 못 하면: 충돌 지점 한 번, 에너지 전부
 * - 관통하면: 충돌 지점에 contactShare, 나머지를 경로 위 spacing 간격 지점들에 앞쪽일수록 크게
 *   (선형 감소) 나눈다. 마지막 지점은 깊이 끝. 지면(groundY) 아래로 들어가면 거기서 끝.
 * 에너지 합 = energy (지면에서 잘린 몫은 남은 지점들에 다시 나눈다).
 */
export function penetrationBlasts(
  point: Vec3Like,
  dir: Vec3Like,
  energy: number,
  speed: number,
  groundY = 0,
  resistance = 1,
): Blast[] {
  const contact: Blast = { point: { x: point.x, y: point.y, z: point.z }, energy, delay: 0 };
  const depth = penetrationDepth(energy, resistance);
  if (depth <= 0) return [contact];

  const stations: number[] = [];
  const count = Math.ceil(depth / PENETRATION.spacing);
  for (let i = 1; i <= count; i++) {
    const d = Math.min(i * PENETRATION.spacing, depth);
    if (point.y + dir.y * d < groundY) break; // 땅속으로는 안 판다
    stations.push(d);
  }
  if (stations.length === 0) return [contact];

  contact.energy = energy * PENETRATION.contactShare;
  const rest = energy - contact.energy;
  // 앞쪽(얕은) 지점일수록 크게: 가중치 n, n-1, …, 1
  const n = stations.length;
  const weightSum = (n * (n + 1)) / 2;
  const blasts = [contact];
  stations.forEach((d, i) => {
    blasts.push({
      point: { x: point.x + dir.x * d, y: point.y + dir.y * d, z: point.z + dir.z * d },
      energy: (rest * (n - i)) / weightSum,
      delay: speed > 0 ? d / speed : 0,
    });
  });
  return blasts;
}

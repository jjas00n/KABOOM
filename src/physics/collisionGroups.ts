// Rapier 충돌 그룹. 32비트 = 상위 16비트 소속(membership) | 하위 16비트 충돌 대상(filter).
// 두 콜라이더는 (A 소속 & B 대상) && (B 소속 & A 대상) 일 때만 부딪힌다. 기본값은 0xffffffff(전부).
//
// 잔해(구조에서 떨어져 나간 조각)는 포탄과 부딪히지 않는다: 이전 발사의 잔해가 구멍 안에 쌓여 있어도
// 다음 포탄이 그걸 '건물'로 착각해 일찍 터지지 않고 서 있는 구조까지 날아간다.
// 잔해는 그 뒤 폭발이 날려 버린다. 잔해끼리, 잔해와 구조·지면은 그대로 부딪힌다.
const ALL = 0xffff;

export const GROUP = {
  projectile: 1 << 1,
  debris: 1 << 2,
} as const;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & ALL) << 16) | (filter & ALL);
}

export const PROJECTILE_GROUPS = interactionGroups(GROUP.projectile, ALL & ~GROUP.debris);
export const DEBRIS_GROUPS = interactionGroups(GROUP.debris, ALL & ~GROUP.projectile);

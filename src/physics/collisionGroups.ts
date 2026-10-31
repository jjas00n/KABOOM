// Rapier 충돌 그룹. 32비트 = 상위 16비트 소속(membership) | 하위 16비트 충돌 대상(filter).
// 두 콜라이더는 (A 소속 & B 대상) && (B 소속 & A 대상) 일 때만 부딪힌다. 기본값은 0xffffffff(전부).
//
// 움직이는 잔해(dynamic)는 발사체와 부딪히지 않는다: 날아다니는 파편에 포탄이 일찍 터지지 않게.
// 잔해가 굳으면(fixed) 기본 그룹으로 돌아가 다시 맞는다 — 보이는 조각은 반드시 맞아야 한다
// (예전엔 굳은 뒤에도 잔해 그룹이라, 제자리에 끼여 멀쩡해 보이는 조각을 포탄이 그냥 통과했다).
// 잔해끼리, 잔해와 구조·지면은 그대로 부딪힌다.
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
/** Rapier 기본값: 전부와 부딪힘 (구조·굳은 잔해) */
export const DEFAULT_GROUPS = 0xffffffff;

/** 두 그룹 값이 서로 부딪히는지 (Rapier 규칙과 같다) */
export function groupsInteract(a: number, b: number): boolean {
  return ((a >>> 16) & b & ALL) !== 0 && ((b >>> 16) & a & ALL) !== 0;
}

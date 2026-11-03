// 건물 종류(아키타입) 레지스트리: (params) → Building. office = 기존 절차적 사무실 건물,
// 나머지는 7-4 입문 건물 (아주 약하다. 작은 받침만 앵커, 내구도 0).
import { TINY } from '../../config';
import { createRng, type Rng } from '../../fracture/seeds';
import { generateBuilding, type Building, type BuildingParams } from '../BuildingGenerator';
import type { Member } from '../Member';
import { brickHut } from './brickHut';
import { glassStatue } from './glassStatue';
import { sandcastle } from './sandcastle';
import { woodShed } from './woodShed';

export const ARCHETYPES = ['office', 'glassStatue', 'brickHut', 'woodShed', 'sandcastle'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
/** 입문 건물 (tiny 주문) */
export const TINY_ARCHETYPES: readonly Archetype[] = [
  'glassStatue',
  'brickHut',
  'woodShed',
  'sandcastle',
];

/** 입문 건물 생성기: rng = 건물 seed 난수 (모양 변주) */
type TinyGenerator = (rng: Rng) => Member[];

const TINY_GENERATORS: Record<Exclude<Archetype, 'office'>, TinyGenerator> = {
  glassStatue,
  brickHut,
  woodShed,
  sandcastle,
};

/** 건물 seed와 섞는 값 (분할 시드와 다른 난수열) */
const SHAPE_SALT = 0x51a7e5;

export function buildArchetype(params: BuildingParams): Building {
  const archetype = params.archetype ?? 'office';
  if (archetype === 'office') return generateBuilding(params);
  const rng = createRng((params.seed ^ SHAPE_SALT) >>> 0);
  // 전체 크기 변주 (균등 배율: 접촉 평면이 그대로 맞는다)
  const scale = 1 + TINY.vary * (2 * rng() - 1);
  const members = TINY_GENERATORS[archetype](rng).map((m) => scaleMember(m, scale));
  return { members, ...extent(members) };
}

/** 앵커(받침) 제외 부재 외곽 + 최고 높이 */
function extent(members: readonly Member[]): Pick<Building, 'footprint' | 'height'> {
  const min = { x: Infinity, y: 0, z: Infinity };
  const max = { x: -Infinity, y: 0, z: -Infinity };
  let height = 0;
  for (const m of members) {
    height = Math.max(height, m.box.max.y);
    if (m.anchor) continue;
    min.x = Math.min(min.x, m.box.min.x);
    min.z = Math.min(min.z, m.box.min.z);
    max.x = Math.max(max.x, m.box.max.x);
    max.z = Math.max(max.z, m.box.max.z);
  }
  return { footprint: { min, max }, height };
}

function scaleMember(m: Member, s: number): Member {
  const b = m.box;
  return {
    ...m,
    box: {
      min: { x: b.min.x * s, y: b.min.y * s, z: b.min.z * s },
      max: { x: b.max.x * s, y: b.max.y * s, z: b.max.z * s },
    },
    planes: m.planes?.map((p) => ({ ...p, d: p.d * s })),
  };
}

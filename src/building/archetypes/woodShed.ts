// 나무 헛간: 석재 받침 + 모서리 기둥 4 + 가로 판자 벽 + 깔도리(윗면 = 지붕 경사) + 외쪽 경사 지붕 판자.
// 판자는 결 방향으로 길게 쪼개진다 (grain). 나무는 연료가 많고 불이 잘 번져 파이어볼 한 발에 탄다.
import { TINY } from '../../config';
import type { Plane } from '../../fracture/polyhedron';
import type { Rng } from '../../fracture/seeds';
import { box, type Member } from '../Member';
import { boxMember, convexMember, plane, slopedSlab } from '../shapes';

export function woodShed(rng: Rng): Member[] {
  const t = TINY.woodShed;
  const [bw, bh, bd] = t.base;
  const members: Member[] = [
    boxMember('foundation', 'stone', box(-bw / 2, 0, -bd / 2, bw / 2, bh, bd / 2), {
      anchor: true,
    }),
  ];
  const p = t.post / 2;
  const px = t.postX;
  const pz = t.postZ;
  const xo = px + p; // 기둥 바깥면 x
  const zo = pz + p; // 기둥 바깥면 z
  const b = t.board;
  // 지붕 아랫면 평면: 앞(z = -zo - b)에서 roofFront, 뒤(z = zo + b)에서 roofBack. y(z) = a + s·z
  const zf = -zo - b;
  const zb = zo + b;
  const slope = (t.roofBack - t.roofFront) / (zb - zf);
  const roofY = (z: number) => t.roofFront + slope * (z - zf);
  // 아랫면 아래쪽이 안 (n·x <= d): 위로 향하는 법선
  const under: Plane = plane(0, 1, -slope, 0, roofY(0), 0);

  // 깔도리 (앞/뒤): 기둥 위, 윗면을 지붕 평면으로 자른다
  const frontPlate = roofY(-pz + p) - t.plate; // 깔도리 아랫면 = 앞 기둥 꼭대기
  const backPlate = roofY(pz + p) - t.plate;
  for (const [z0, z1, y0] of [
    [-zo, -pz + p, frontPlate],
    [pz - p, zo, backPlate],
  ] as const) {
    members.push(
      convexMember('post', 'wood', box(-xo, y0, z0, xo, roofY(z0) + 0.01, z1), [under], {
        grain: { axis: 0, stretch: t.grainStretch },
      }),
    );
  }
  // 기둥
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = sz < 0 ? frontPlate : backPlate;
      members.push(
        boxMember(
          'post',
          'wood',
          box(sx * px - p, bh, sz * pz - p, sx * px + p, top, sz * pz + p),
          {
            grain: { axis: 1, stretch: t.grainStretch },
          },
        ),
      );
    }
  }

  // 벽 판자 (줄 높이 boardRow). 앞: 문 (변주: 가운데 / 오른쪽), 뒤·옆: 막힘
  const [doorW, doorH] = t.door;
  const doorC = rng() < 0.5 ? 0 : px / 2;
  const rows = (top: number) => {
    const out: [number, number][] = [];
    for (let y = bh; y < top - 1e-6; y += t.boardRow) out.push([y, Math.min(y + t.boardRow, top)]);
    return out;
  };
  const along = (axis: 0 | 2) => ({ grain: { axis, stretch: t.grainStretch } });
  for (const [y0, y1] of rows(frontPlate)) {
    const spans: [number, number][] =
      y0 < bh + doorH
        ? [
            [-xo, doorC - doorW / 2],
            [doorC + doorW / 2, xo],
          ]
        : [[-xo, xo]];
    for (const [a, c] of spans) {
      members.push(boxMember('plank', 'wood', box(a, y0, -zo - b, c, y1, -zo), along(0)));
    }
  }
  for (const [y0, y1] of rows(backPlate)) {
    members.push(boxMember('plank', 'wood', box(-xo, y0, zo, xo, y1, zo + b), along(0)));
  }
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -xo - b : xo;
    for (const [y0, y1] of rows(backPlate)) {
      members.push(boxMember('plank', 'wood', box(x0, y0, -zo, x0 + b, y1, zo), along(2)));
    }
  }

  // 지붕 판자: z 방향으로 기울어진 경사판, 아랫면 = 깔도리 윗면 평면
  const z0 = zf - t.roofOverhang;
  const z1 = zb + t.roofOverhang;
  const half = xo + b + t.roofOverhang / 2;
  const n = Math.max(1, Math.round((2 * half) / t.roofPlank));
  for (let i = 0; i < n; i++) {
    const a = -half + (2 * half * i) / n;
    const c = -half + (2 * half * (i + 1)) / n;
    members.push(
      slopedSlab('plank', 'wood', a, c, z0, z1, roofY(z0), roofY(z1), t.roofThickness, along(2)),
    );
  }
  return members;
}

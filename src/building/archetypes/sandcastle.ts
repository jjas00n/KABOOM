// 모래성: 얇은 모래 받침 + 모서리 8각 탑 4 (고깔) + 탑 사이 성벽(흉벽 톱니) + 가운데 큰 탑.
// 가장 약한 건물: 모래는 엣지가 가장 약하고 먼지가 크다.
import { TINY } from '../../config';
import type { Rng } from '../../fracture/seeds';
import { box, type Member } from '../Member';
import { boxMember, ngonColumn, taperedColumn } from '../shapes';

export function sandcastle(rng: Rng): Member[] {
  const t = TINY.sandcastle;
  const [bw, bh, bd] = t.base;
  const members: Member[] = [
    boxMember('foundation', 'sand', box(-bw / 2, 0, -bd / 2, bw / 2, bh, bd / 2), { anchor: true }),
  ];
  const a = t.towerApothem;
  const o = t.towerOffset;
  const towerTop = bh + t.towerHeight;
  const cap = (cx: number, cz: number, y0: number, half: number) =>
    taperedColumn('roof', 'sand', cx, cz, y0, y0 + t.capHeight, [half, half], [t.capTop, t.capTop]);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      members.push(ngonColumn('tower', 'sand', sx * o, sz * o, a, bh, towerTop, t.towerSides));
      members.push(cap(sx * o, sz * o, towerTop, a * 0.85));
    }
  }

  // 성벽: 탑의 평평한 ±x/±z 면 사이 (8각이라 면 폭 2a·tan(π/8) > 성벽 두께)
  const h = t.wallThickness / 2;
  const wallTop = bh + t.wallHeight;
  const [mw, mh] = t.merlon;
  const walls: { x0: number; x1: number; z0: number; z1: number; alongX: boolean }[] = [];
  for (const s of [-1, 1]) {
    walls.push({ x0: -o + a, x1: o - a, z0: s * o - h, z1: s * o + h, alongX: true });
    walls.push({ x0: s * o - h, x1: s * o + h, z0: -o + a, z1: o - a, alongX: false });
  }
  for (const w of walls) {
    members.push(boxMember('rampart', 'sand', box(w.x0, bh, w.z0, w.x1, wallTop, w.z1)));
    // 흉벽 톱니: 성벽 윗면에 띄엄띄엄
    const [u0, u1] = w.alongX ? [w.x0, w.x1] : [w.z0, w.z1];
    const pitch = mw + t.merlonGap;
    const n = Math.floor((u1 - u0 + t.merlonGap) / pitch);
    const start = (u0 + u1) / 2 - (n * pitch - t.merlonGap) / 2;
    for (let i = 0; i < n; i++) {
      const m0 = start + i * pitch;
      const m1 = m0 + mw;
      members.push(
        boxMember(
          'merlon',
          'sand',
          w.alongX
            ? box(m0, wallTop, w.z0, m1, wallTop + mh, w.z1)
            : box(w.x0, wallTop, m0, w.x1, wallTop + mh, m1),
        ),
      );
    }
  }

  // 가운데 큰 탑 (변주: 8각 / 12각) + 고깔
  const keepTop = bh + t.keepHeight;
  members.push(ngonColumn('tower', 'sand', 0, 0, t.keepApothem, bh, keepTop, rng() < 0.5 ? 8 : 12));
  members.push(cap(0, 0, keepTop, t.keepApothem * 0.85));
  return members;
}

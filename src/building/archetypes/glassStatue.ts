// 크리스털 수호상: 석재 받침 위 크리스털 인물상 (오리지널, 추상 형태).
// 다리·목이 가늘어 먼저 끊기고 윗몸이 통째로 넘어간다. 크리스털은 판재라 화염 폭발에 열충격으로 전부 깨진다.
import { TINY } from '../../config';
import type { Rng } from '../../fracture/seeds';
import { box, type Member } from '../Member';
import { boxMember, gable, ngonColumn, taperedColumn } from '../shapes';

export function glassStatue(rng: Rng): Member[] {
  const t = TINY.glassStatue;
  const [pw, ph, pd] = t.pedestal;
  const members: Member[] = [
    boxMember('foundation', 'stone', box(-pw / 2, 0, -pd / 2, pw / 2, ph, pd / 2), {
      anchor: true,
    }),
  ];
  const c = (m: Member) => members.push(m);

  // 다리 (8각)
  const legTop = ph + t.legHeight;
  for (const sx of [-1, 1]) {
    c(ngonColumn('sculpture', 'crystal', sx * t.legSpacing, 0, t.legApothem, ph, legTop, 8));
  }
  // 골반 → 몸통 (역삼각 테이퍼) → 어깨
  const [hw, hh, hd] = t.hips;
  const hipTop = legTop + hh;
  c(boxMember('sculpture', 'crystal', box(-hw / 2, legTop, -hd / 2, hw / 2, hipTop, hd / 2)));
  const torsoTop = hipTop + t.torsoHeight;
  c(taperedColumn('sculpture', 'crystal', 0, 0, hipTop, torsoTop, t.torsoBottom, t.torsoTop));
  const [sw, sh, sd] = t.shoulders;
  const shoulderTop = torsoTop + sh;
  c(
    boxMember('sculpture', 'crystal', box(-sw / 2, torsoTop, -sd / 2, sw / 2, shoulderTop, sd / 2)),
  );
  // 팔: 어깨 끝에 매달린다. 변주: 한쪽 팔을 조금 짧게
  const shorter = rng() < 0.5 ? -1 : 1;
  for (const sx of [-1, 1]) {
    const length = t.armLength * (sx === shorter ? 0.75 : 1);
    c(
      ngonColumn(
        'sculpture',
        'crystal',
        sx * t.armX,
        0,
        t.armApothem,
        torsoTop - length,
        torsoTop,
        8,
      ),
    );
  }
  // 목 → 머리 (테이퍼) → 볏 (박공)
  const neckTop = shoulderTop + t.neckHeight;
  c(ngonColumn('sculpture', 'crystal', 0, 0, t.neckApothem, shoulderTop, neckTop, 8));
  const headTop = neckTop + t.headHeight;
  c(taperedColumn('sculpture', 'crystal', 0, 0, neckTop, headTop, t.headBottom, t.headTop));
  const [cw, ch, cd] = t.crest;
  c(
    gable(
      'sculpture',
      'crystal',
      box(-cw / 2, headTop, -cd / 2, cw / 2, headTop + ch, cd / 2),
      'z',
    ),
  );
  return members;
}

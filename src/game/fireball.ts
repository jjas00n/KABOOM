// 파이어볼 수치: 발사체 물리 특성과 화염 폭발 모양 (순수 데이터, 테스트도 같이 쓴다)
import { FIREBALL } from '../config';
import type { BlastProfile } from '../destruction/DestructionSystem';
import type { ProjectileSpec } from './Launcher';

export const FIREBALL_SPEC: ProjectileSpec = {
  kind: 'fireball',
  mass: FIREBALL.mass,
  radius: FIREBALL.radius,
  gravityScale: FIREBALL.gravityScale,
  maxFlightSec: FIREBALL.maxFlightSec,
};

/** 화염 폭발: 넓은 반경에 얕게 부수고 약하게 민다. 반경 안 유리는 전부 깨진다 */
export function fireballProfile(): BlastProfile {
  return {
    radius: FIREBALL.blastRadius,
    coreFraction: FIREBALL.blastCoreFraction,
    edgeFraction: FIREBALL.blastEdgeFraction,
    peakDeltaV: FIREBALL.blastPeakDeltaV,
    glassShatterRadius: FIREBALL.glassShatterRadius,
  };
}

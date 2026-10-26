// 튜닝 상수 모음. 매직 넘버는 코드에 직접 쓰지 말고 여기에 추가한다.
// 단위: 길이 m, 질량 kg, 시간 s, 각도 rad.

export type QualityPreset = 'low' | 'medium' | 'high';

/** 품질 프리셋별 건물 전체 목표 조각 수 */
export const QUALITY_PRESETS = {
  low: { targetFragments: 1500 },
  medium: { targetFragments: 4000 },
  high: { targetFragments: 8000 },
} as const satisfies Record<QualityPreset, { targetFragments: number }>;

export const DEFAULT_QUALITY: QualityPreset = 'medium';

export const PHYSICS = {
  fixedTimestep: 1 / 60,
  maxSubSteps: 5, // TODO(Phase1): 프레임 드랍 시 스파이럴 방지 상한 튜닝
  gravity: { x: 0, y: -9.81, z: 0 },
} as const;

export const FRACTURE = {
  // 부재별 시드 밀도 (seeds / m^3). 외벽 패널 > 슬래브 > 기둥 순으로 잘게.
  // TODO(Phase3): 프리셋 목표 조각 수에 맞게 튜닝
  seedDensity: {
    wallPanel: 40,
    slab: 12,
    column: 6,
    glass: 80,
  },
  adaptiveSeedRadius: 3, // TODO(Phase2)
  adaptiveSeedMultiplier: 4, // TODO(Phase2)
} as const;

export const CANNON = {
  yawLimit: Math.PI / 3, // TODO(Phase5)
  pitchMin: -Math.PI / 36, // TODO(Phase5)
  pitchMax: Math.PI / 3, // TODO(Phase5)
} as const;

export const PROJECTILE = {
  mass: 500, // TODO(Phase5)
  radius: 0.4, // TODO(Phase5)
  muzzleSpeedMin: 40, // TODO(Phase5)
  muzzleSpeedMax: 120, // TODO(Phase5)
} as const;

export const EXPLOSION = {
  radius: 4, // TODO(Phase4)
  impulseScale: 1, // TODO(Phase4)
  falloffExponent: 2, // TODO(Phase4)
} as const;

export const DEBRIS = {
  maxDynamicFragments: 3000,
  sleepAfterSec: 2, // TODO(Phase4)
  fadeOutSec: 8, // TODO(Phase4)
  killY: -20, // 이 높이 아래로 떨어진 조각은 제거
} as const;

export const HIT_STOP = {
  timeScale: 0.15,
  durationSec: 0.3,
} as const;

export const CAMERA = {
  cutsceneDurationSec: 3,
  spectateAutoSec: 4,
  chaseSmoothing: 0.1, // TODO(Phase5)
} as const;

export const RENDER = {
  shadowMapSize: 2048,
} as const;

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
  // 한 프레임 최대 물리 스텝 수 (spiral of death 방지). 스텝이 프레임보다 비싸지면 FPS 대신 물리가
  // 실시간보다 느려진다(자연스러운 슬로모션). 5였을 때 붕괴 구간이 5배로 증폭됐다 (docs/PERF.md).
  maxSubSteps: 2,
  maxFrameDt: 0.25, // 탭 전환 등으로 생긴 거대 dt 상한
  gravity: { x: 0, y: -9.81, z: 0 },
  solverIterations: 2, // Rapier 기본 4. 잔해 더미 붕괴 구간 비용을 줄인다 (docs/PERF.md)
} as const;

export const FRACTURE = {
  // 부재별 상대 시드 밀도 (seeds / m^3). 절대값이 아니라 비율로 쓰인다:
  // 프리셋 목표 조각 수에 맞게 전체를 스케일한다 (building/seedBudget.ts).
  // 외벽 패널 > 슬래브 > 기둥 순으로 잘게. 유리는 얇아서 부피당 밀도가 아주 높아야 크랙처럼 보인다.
  seedDensity: {
    foundation: 0.5,
    column: 6,
    beam: 8,
    slab: 12,
    wallPanel: 40,
    parapet: 30,
    glass: 400,
  },
  adaptiveSeedRadius: 3, // 이 반경 안에서 시드 밀도가 올라간다
  adaptiveSeedMultiplier: 4, // 중심점에서의 밀도 배수 (반경 끝에서 1배로 선형 감소)
  adaptiveMaxAttempts: 100, // 기각 샘플링: 시드 1개당 최대 시도 횟수
  jitter: 0.8, // 지터 그리드: 칸 크기 대비 흔들림 비율 (0 = 정격자, 1 = 칸 전체)
  planeEpsilon: 1e-7, // 반공간 판정 허용 오차 (m)
  weldEpsilon: 1e-6, // 같은 점으로 볼 거리 (m)
  minFaceArea: 1e-8, // 이보다 작은 면은 버린다 (m^2)
  contactEpsilon: 1e-6, // 부재끼리 맞닿았다고 볼 면 사이 거리 (m)
  uvScale: 0.5, // 텍스처 반복 / m (월드 좌표 평면 투영)
  progressEvery: 64, // 워커가 진행률을 보내는 셀 간격
} as const;

/** 재질 물성 */
export const CONCRETE = {
  density: 2400, // kg/m^3
  exteriorColor: 0xb8b2a7,
  exteriorRoughness: 0.9,
  interiorColor: 0x77706a, // 단면: 더 어둡고 거칠게
  interiorRoughness: 1,
  friction: 0.8,
} as const;

export const GLASS = {
  density: 2500, // kg/m^3 (얇아서 조각은 가볍다)
  friction: 0.4,
  color: 0x9fc4d6,
  roughness: 0.05,
  metalness: 0,
  opacity: 0.35,
} as const;

/** 절차적 건물 기본 파라미터와 부재 치수 (m) */
export const BUILDING = {
  floors: 6,
  baysX: 4,
  baysZ: 3,
  floorHeight: 3.5,
  columnSpacing: 6, // 기둥 중심 간격
  windowRatio: 0.55, // 창 크기 = 기둥 사이 순 폭/높이 × 이 값 (0이면 창 없음)
  seed: 1,
  limits: { floors: [1, 12], bays: [1, 8], windowRatio: [0, 0.8] },

  columnSize: 0.6, // 정사각 단면. panelThickness + beamWidth 이상이어야 외곽 보와 패널이 안 겹친다
  slabThickness: 0.3,
  beamWidth: 0.3,
  beamDepth: 0.5,
  panelThickness: 0.25,
  glassThickness: 0.03,
  sillFraction: 0.45, // 창 아래 벽(창대) 높이 = (순 높이 - 창 높이) × 이 값
  foundationThickness: 0.6,
  foundationMargin: 1, // 기초가 건물 외곽보다 튀어나온 폭
  parapetHeight: 1.1,
  parapetThickness: 0.2,
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
  peakDeltaV: 14, // 폭심에서 조각이 얻는 속도 (m/s). 임펄스 = 질량 × 이 값 × 감쇠
  upwardBias: 0.3, // 방향 벡터에 더하는 위쪽 성분 (흙먼지처럼 솟구치게)
  spin: 2, // 무작위 회전 임펄스 배수 (rad/s 단위 근사)
  falloffExponent: 2, // TODO(Phase4)
} as const;

/**
 * 잔해 정책 (destruction/DebrisManager.ts). 측정 근거는 docs/PERF.md.
 * 붕괴 직후 수천 개의 dynamic 조각이 서로 비비며 잠들지 않는 것이 FPS 병목이었다.
 */
export const DEBRIS = {
  maxDynamicFragments: 1500, // 초과하면 작은(같으면 오래된) 조각부터 제거
  // 이 속도 아래로 settleAfterSec 동안 머문 조각은 fixed로 굳혀 시뮬레이션에서 뺀다.
  // rb.sleep()만으로는 부족하다: 잔해 더미는 하나의 island라 이웃이 계속 깨운다 (docs/PERF.md).
  settleLinearSpeed: 0.2, // m/s
  settleAngularSpeed: 0.5, // rad/s
  settleAfterSec: 0.5, // Infinity면 끔
  freezeAfterSec: 0.5, // Rapier가 스스로 재운 조각도 이만큼 지나면 fixed로 (Infinity면 끔)
  linearDamping: 0.1, // dynamic 조각 감쇠: 구르기/미끄러짐을 빨리 멈추게
  angularDamping: 0.8,
  simpleColliderPercentile: 0.3, // 부피 하위 이 비율의 조각은 cuboid 콜라이더 (0이면 끔)
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
  shadowCameraSize: 30, // 방향광 그림자 카메라 반경
  // 법선 방향 오프셋(m). 조각 이음매에서 표면 바로 아래 단면이 그림자 맵에 찍혀 생기는 줄무늬(acne) 방지
  shadowNormalBias: 0.03,
  maxPixelRatio: 2,
  exposure: 1,
  fov: 50,
  near: 0.1,
  far: 1000,
} as const;

export const LIGHTING = {
  background: 0x9fb4c8,
  sunColor: 0xfff1e0,
  sunIntensity: 3,
  sunPosition: { x: 20, y: 35, z: 15 },
  hemiSkyColor: 0xbcd4ff,
  hemiGroundColor: 0x5a5046,
  hemiIntensity: 1,
} as const;

export const DEBUG = {
  fpsSampleSec: 0.5,
} as const;

/** Phase 3 건물 데모 (대포가 들어오면 game/으로 이동) */
export const BUILDING_DEMO = {
  explosionRadius: 3, // 클릭 지점에서 이 반경 안 조각을 dynamic으로
  cameraPosition: { x: 38, y: 22, z: 44 },
  cameraTarget: { x: 0, y: 9, z: 0 },
  debugColorSeed: 7, // 조각 경계 색칠용 난수 시드
  // 성능 측정 시나리오: 모든 층의 정면(-z)과 오른쪽(+x) 외벽 칸 중앙을 폭파 (6층 4×3 → 42곳)
  smashSeed: 99, // 성능 측정 시나리오의 회전 난수 시드
} as const;

/** Phase 2 분할 데모 전용 (건물이 들어오면 제거) */
export const FRACTURE_DEMO = {
  boxMin: { x: -2, y: 0.001, z: -1 }, // 지면과 살짝 띄워 초기 겹침 방지
  boxMax: { x: 2, y: 3, z: 1 },
  seedCount: 300,
  rngSeed: 1337,
  explosionRadius: 3,
  cameraPosition: { x: 6, y: 4.5, z: 8 },
  cameraTarget: { x: 0, y: 1.5, z: 0 },
} as const;

/** Phase 1 물리 샌드박스 전용 (건물/대포가 들어오면 제거) */
export const SANDBOX = {
  boxGrid: { x: 10, y: 5, z: 4 }, // = 200개
  boxSize: 1,
  boxGap: 0.01, // 초기 겹침으로 튀는 것 방지
  groundSize: 200,
  groundThickness: 1,
  groundColor: 0x6b6b66,
  boxColor: 0xb8b2a7,
  boxColorJitter: 0.15, // 인스턴스별 밝기 변주
  sphereColor: 0x2b2b2b,
  cameraPosition: { x: 18, y: 12, z: 22 },
  cameraTarget: { x: 0, y: 2.5, z: 0 },
  sphereSpawnOffset: 1, // 카메라 앞 몇 m에서 발사할지
  sphereRadius: 0.5,
  sphereSpeed: 60,
  sphereDensity: 20,
  maxSpheres: 32,
  clickDragThresholdPx: 5,
} as const;

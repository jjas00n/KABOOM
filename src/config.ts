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
/** 대포 (game/Cannon.ts). 건물 중심이 원점, 대포는 +z쪽 언덕 위에서 -z(건물)를 향한다. */
export const CANNON = {
  position: { x: 0, z: 62 },
  hillRadius: 16,
  hillHeight: 3,
  // 받침과 포신 (m)
  baseRadius: 1.7,
  baseHeight: 1.1,
  trimHeight: 0.25, // 받침 위 테두리 링 두께
  pivotHeight: 1.7, // 받침 바닥에서 포신 회전축까지
  barrelLength: 4.6, // 회전축에서 포구까지
  barrelRadius: 0.75,
  breechRadius: 0.95, // 뒤쪽 약실 둥근 부분
  muzzleFlare: 1.0, // 포구 테두리 반지름
  boreRadius: 0.5, // 포구 안쪽 구멍 (포탄 반지름보다 커야 함)
  holeRadius: 2.4, // 대포가 솟아오르는 땅 구멍
  barrelColor: 0x24242b,
  baseColor: 0x34343c,
  trimColor: 0xd8b03a,
  holeColor: 0x080808,
  hillColor: 0x5b7f39,
  metalness: 0.35, // 환경맵이 없어서(Phase 6) 금속도가 높으면 거의 새까맣게 보인다
  roughness: 0.45,
  riseDepth: 5, // 등장 전 땅속 깊이
  riseSec: 1.4,
  // 조준 각도 (건물 쪽 기본 방향 기준)
  yawLimit: Math.PI / 3,
  pitchMin: -Math.PI / 36,
  pitchMax: Math.PI / 3,
  startPitch: 0.12, // 컷신 뒤 처음 각도
  dragSensitivity: 0.004, // 드래그 1px당 회전 (rad)
  keySpeed: 0.9, // WASD/방향키 회전 속도 (rad/s)
  wheelPowerStep: 0.05, // 휠 한 칸당 파워 변화 (0~1)
  keyPowerSpeed: 0.6, // Q/E 파워 변화 속도 (/s)
  recoilDistance: 0.7, // 발사 반동으로 포신이 밀리는 거리
  recoilReturnSec: 0.45,
  smokePuffs: 10,
  smokeLifeSec: 1.6,
  smokeSize: 1.4, // 연기 스프라이트 시작 크기 (m), 사는 동안 3배까지 커진다
  smokeSpeed: 3, // 연기가 포구에서 뿜어지는 속도 (m/s)
} as const;

export const PROJECTILE = {
  mass: 500, // kg
  radius: 0.4,
  muzzleSpeedMin: 40, // 파워 0
  muzzleSpeedMax: 120, // 파워 1
  defaultPower: 0.45,
  maxFlightSec: 8, // 이만큼 날아도 아무것도 안 맞으면 빗나간 것으로
  color: 0x111114,
  // 예상 궤적 점선
  trajectoryStepSec: 0.04,
  trajectoryMaxSec: 4,
  trajectoryColor: 0xffe28a,
  trajectoryDashSize: 0.8,
  trajectoryGapSize: 0.6,
} as const;

export const EXPLOSION = {
  radius: 4, // applyExplosion 기본 반경 (에너지로 반경을 정하지 않을 때)
  // 에너지(J) → 파괴 반경: radiusPerCubeRootJoule × ∛E, [minRadius, maxRadius]로 자름.
  // 포탄 500kg × 80m/s (1.6MJ) ≈ 반경 3.5m
  radiusPerCubeRootJoule: 0.03,
  minRadius: 1,
  maxRadius: 8,
  coreFraction: 0.5, // 반경의 이 비율 안 조각은 구조에서 완전히 떨어져 날아간다 (나머지는 엣지만 끊김)
  peakDeltaV: 14, // 폭심에서 조각이 얻는 속도 (m/s). 임펄스 = 질량 × 이 값 × 감쇠
  upwardBias: 0.3, // 방향 벡터에 더하는 위쪽 성분 (흙먼지처럼 솟구치게)
  spin: 2, // 무작위 회전 임펄스 배수 (rad/s 단위 근사)
  falloffExponent: 2,
} as const;

/** 구조 무결성 그래프와 붕괴 (building/StructureGraph.ts, destruction/CollapseSolver.ts) */
export const STRUCTURE = {
  // 외장재: 구조에 매달려 지지는 받지만 위의 구조를 떠받치지 않는다.
  // (이게 없으면 1층 기둥을 다 없애도 외벽 패널이 건물 전체를 받쳐 버린다)
  cladding: ['wallPanel', 'glass', 'parapet'],
  strengthPerArea: 1e5, // 접촉면 1m²가 버티는 하중 (kg). 기하 기준 강도 (실제 콘크리트의 ~3%: 게임용)
  materialFactor: { concrete: 1, glass: 0.1 }, // 엣지 강도 = 면적 × strengthPerArea × min(양쪽 계수)
  jointFactor: 0.5, // 부재 사이 이음매는 부재 안보다 약하다
  // 멀쩡한 건물에서 계산한 하중 × intactSafety 보다는 항상 강하게: 자중으로는 무너지지 않는다.
  // 기둥이 빠져 하중이 이 배수 넘게 몰리는 엣지부터 끊긴다.
  intactSafety: 1.6,
  failureTime: 0.5, // 과부하율 2배(하중 = 강도 × 2)인 엣지가 끊기기까지 걸리는 시간 (s)
  // 엣지가 끊길 때마다 지지/하중을 다시 계산하면(≈3ms) 붕괴 중 매 스텝 돌게 된다 → 이 간격으로 묶는다.
  // 폭발 직후는 force로 즉시 계산.
  solveIntervalSec: 0.1,
  // 하중 경로 비용 (엣지 길이 m 기준): 아래로 얹힘 = 길이, 옆 = 길이 × (1 + lateralCost),
  // 위로 매달림 = + 올라가는 높이 × hangCost, 엣지마다 + hopCost
  lateralCost: 2,
  hangCost: 4,
  hopCost: 0.05,
  // 캔틸레버 가중: 요구량 = 하중 × (1 + cantileverFactor × 수직 지지까지 수평 거리 m)
  cantileverFactor: 0.5,
  // 떨어지는 덩어리가 이만큼 속도가 급변하면(m/s, 한 스텝) 충격으로 보고 약한 내부 엣지부터 끊는다
  impactSpeedChange: 3,
  // 충격 속도 변화 Δv에서 엣지가 끊길 조건: Δv > impactBreakSpeed × √(엣지 응력 / strengthPerArea)
  impactBreakSpeed: 4,
  minChunkFragments: 3, // 분해 후 이보다 작은 덩어리는 개별 조각으로
  // 연쇄: 움직이는 조각이 서 있는 조각에 부딪힐 때 운동에너지(J) >
  // chainJoulesPerKg × 맞은 조각이 버티는 엣지 강도 합(kg) 이면 맞은 조각이 떨어져 나간다
  chainJoulesPerKg: 0.5,
  chainMinSpeed: 4, // 이보다 느린 충돌은 검사하지 않는다 (m/s)
  wakeMargin: 1, // 덩어리가 떨어질 때 그 AABB + 이 여유 안의 굳은 잔해를 다시 깨운다 (m)
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
  fadeVolume: 0.004, // 굳은 뒤 이보다 작은 조각(m^3, ≈16cm 정육면체)은 페이드아웃
  fadeOutSec: 8, // 굳고 나서 페이드아웃 시작까지
  fadeDurationSec: 1, // 작아지며 사라지는 시간
  killY: -20, // 이 높이 아래로 떨어진 조각은 제거
} as const;

/**
 * 관통 (game/penetration.ts): 포탄 에너지가 문턱을 넘으면 맞은 면 뒤로 파고들며 추가 폭발.
 * 관통 깊이 = (에너지 - minEnergy) / energyPerMeter, maxDepth로 자름.
 * 파워별 대략 (500kg): 76m/s(1.4MJ) ≈ 0.5m, 96m/s(2.3MJ) ≈ 2.8m, 120m/s(3.6MJ) ≈ 6m
 */
export const PENETRATION = {
  minEnergy: 1.25e6, // J. 이보다 약하면 표면에서 끝
  energyPerMeter: 4e5, // J/m. 파고드는 데 드는 에너지 (콘크리트 저항)
  maxDepth: 10, // m
  contactShare: 0.55, // 관통할 때 표면 폭발에 쓰는 에너지 비율. 나머지는 안쪽 폭발들로
  spacing: 2, // 안쪽 폭발 사이 간격 (m)
} as const;

export const HIT_STOP = {
  timeScale: 0.15,
  durationSec: 0.3,
} as const;

export const CAMERA = {
  blendSec: 0.9, // 카메라 컨트롤러가 바뀔 때 이전 자세에서 넘어가는 시간
  // IDLE: 건물 전경을 천천히 돈다
  idleRadius: 60,
  idleHeight: 26,
  idleSpeed: 0.06, // rad/s
  // 컷신: 현재 위치 → 건물 전경 → 대포 뒤
  cutsceneDurationSec: 3,
  cutsceneOverviewRadius: 48, // 건물 전경 지점 (건물 중심에서 거리)
  cutsceneOverviewHeight: 30,
  cutsceneSideAngle: 0.9, // 전경 지점을 대포 방향에서 옆으로 돌리는 각 (rad) → 호를 그리며 비행
  // 조준: 포신 뒤·위 3인칭
  aimBack: 9.5,
  aimUp: 4.2,
  aimAhead: 30,
  // 체이스: 포탄 뒤·위, 지수 스무딩
  chaseBack: 9,
  chaseUp: 3,
  chaseLead: 12,
  chaseSmoothing: 0.12, // 시간상수 (s): 작을수록 바짝 따라간다
  // 관람: 충돌 지점을 천천히 돌다가 궤도 조작으로
  spectateAutoSec: 4,
  spectateRadius: 30,
  spectateHeight: 13,
  spectateSpeed: 0.22, // rad/s
  // 흔들림 (camera/CameraShake.ts)
  shakeDecay: 1.4, // trauma 감소 /s
  shakeMaxOffset: 0.7, // m
  shakeMaxRoll: 0.035, // rad
  shakeFrequency: 18, // Hz
  impactTrauma: 1,
  fireTrauma: 0.35,
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
  graphRefreshSec: 0.25, // 구조 그래프 시각화 갱신 주기
  edgeColorIdle: 0x5a6470, // 하중 없는 엣지 (옆 연결 등)
  edgeColorLow: 0x3cd070, // 하중률 0
  edgeColorHigh: 0xff3030, // 하중률 1 이상 (곧 끊김)
  anchorColor: 0x40a0ff,
  anchorSize: 0.25,
} as const;

/** Phase 3 건물 데모 (대포가 들어오면 game/으로 이동) */
export const BUILDING_DEMO = {
  clickEnergy: 1.6e6, // 클릭 폭발 에너지 (J) = 포탄 500kg × 80m/s 상당 → 반경 ≈ 3.5m
  smashEnergy: 1e6, // Smash test 지점별 에너지 (반경 3m)
  columnEnergy: 4e4, // Pull columns: 기둥 하나만 날릴 작은 폭발 (반경 ≈ 1m)
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

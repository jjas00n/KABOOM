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
  uvScale: 0.5, // 외면 텍스처 반복 / m (부재 박스 기준 박스 투영)
  progressEvery: 64, // 워커가 진행률을 보내는 셀 간격
} as const;

/** 재질 물성. 색은 텍스처가 없을 때(테스트) 단색, 있으면 텍스처에 곱하는 틴트. */
export const CONCRETE = {
  density: 2400, // kg/m^3
  exteriorColor: 0xb8b2a7,
  exteriorTint: 0xf2f2f0,
  exteriorBrightness: 1.45, // 텍스처(Concrete042A)가 어두워서 틴트에 곱한다 (1 넘어도 된다)
  exteriorRoughness: 0.9,
  interiorColor: 0x77706a, // 단면: 더 어둡고 거칠게
  interiorTint: 0xffffff, // 갓 깨진 단면은 풍화된 외면보다 밝다
  interiorBrightness: 1.15,
  interiorRoughness: 1,
  normalScale: 0.6,
  friction: 0.8,
} as const;

export type GlassMode = 'reflective' | 'transmission';

export const GLASS = {
  density: 2500, // kg/m^3 (얇아서 조각은 가볍다)
  friction: 0.4,
  color: 0x5d7480,
  roughness: 0.05,
  metalness: 0,
  // 'reflective': 반투명 + 환경 반사 (싸다, 기본). 'transmission': 굴절 투과 (화면 한 번 더 그림 → 비싸다)
  defaultMode: 'reflective' as GlassMode,
  modeByQuality: { low: 'reflective', medium: 'reflective', high: 'transmission' } as Record<
    QualityPreset,
    GlassMode
  >,
  opacity: 0.55, // reflective 모드 불투명도
  envMapIntensity: 1.4, // reflective 모드는 반사를 세게 해 유리처럼 보이게
  transmission: 1,
  ior: 1.5,
  thickness: 0.03, // m (굴절 근사)
} as const;

/**
 * CC0 텍스처 (public/textures, 출처 CREDITS.md). 경로는 BASE_URL 기준.
 * 단면은 트라이플래너: 조각 원래 자리 좌표 × interiorScale (반복 / m).
 */
export const TEXTURES = {
  dir: 'textures/',
  exterior: 'concrete-exterior',
  interior: 'concrete-interior',
  ground: 'ground',
  sky: 'sky.hdr',
  anisotropy: 8,
  interiorScale: 0.8, // 반복 / m
  triplanarSharpness: 4, // 법선 가중 지수: 클수록 축 사이 블렌드 폭이 좁다
  groundScale: 0.25, // 반복 / m
  groundTint: 0xc2bcb2,
  groundVisualSize: 1200, // m. 물리 지면(SANDBOX.groundSize)보다 크게, 끝은 안개 속
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
  metalness: 0.7, // 환경맵(HDRI)을 반사한다
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
  smokeColor: 0xb4b4b4,
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

/** 파이어볼 마법사 (game/Wizard.ts). 오리지널 절차적 디자인: 남색 로브 + 구리 장식 + 지팡이 끝 불씨 구 */
export const WIZARD = {
  position: { x: 0, z: -62 }, // 건물 기준 대포(z = +62) 정반대, 같은 거리
  rockRadius: 3.2,
  rockHeight: 4.2, // 대포 언덕(3m)보다 살짝 높다
  rockRoughness: 0.35, // 반경 대비 표면 울퉁불퉁함
  rockColor: 0x6e6a64,
  rockSeed: 11,
  scale: 1.5, // 아래 치수 전체 배율 (멀리서도 보이게 영웅 크기로)
  robeHeight: 1.5,
  robeBottomRadius: 0.55,
  robeTopRadius: 0.2,
  hemHeight: 0.18, // 로브 아랫단 띠
  headRadius: 0.17,
  hatBrimRadius: 0.5,
  hatBrimThickness: 0.04,
  hatHeight: 0.85,
  hatBend: 0.35, // 모자 끝이 뒤로 꺾이는 정도
  shoulderHeight: 1.38, // 바위 위에서 어깨(팔 회전축)까지 (scale 적용 전)
  shoulderSide: 0.24, // 오른쪽으로
  armLength: 0.5,
  armRadius: 0.075,
  sleeveRadius: 0.13, // 소매 끝 (나팔 모양)
  staffLength: 1.9,
  staffRadius: 0.03,
  staffGrip: 0.55, // 손에서 지팡이 뒤끝까지
  orbRadius: 0.11,
  robeColor: 0x1d2350,
  robeTrimColor: 0xb87333, // 구리
  skinColor: 0xd9b48f,
  hatColor: 0x161a3c,
  staffColor: 0x4a3426,
  orbColor: 0xff9a3c,
  orbBrightness: 6, // HDR (Bloom)
  orbFlickerHz: 3.1,
  // 조준
  yawLimit: Math.PI / 3,
  pitchMin: -Math.PI / 24,
  pitchMax: Math.PI / 4,
  startPitch: 0.05,
  bodyYawFollow: 0.45, // 몸은 조준 yaw의 이만큼만 돈다 (팔·지팡이는 전부)
  // 대기 흔들림
  swayHz: 0.45,
  swayAngle: 0.035, // rad
  hatSwayAngle: 0.08,
  // 등장 (불씨 소용돌이와 함께 0 → 1)
  appearSec: 1.1,
  appearEmbers: 40,
  // 충전 / 발사
  chargeSec: 0.6,
  chargeEmbersPerSec: 70,
  chargeLightIntensity: 120, // 충전 끝 빛 세기 (candela)
  fireFlashIntensity: 900,
  fireFlashSec: 0.25,
  fireTrauma: 0.12, // 대포(0.35)보다 약한 흔들림
  fireRecoilSec: 0.35, // 팔이 살짝 튀었다 돌아오는 시간
  // 카메라: 오른쪽 어깨 너머
  aimBack: 5.5,
  aimUp: 1.6,
  aimAhead: 30,
  aimSide: 1.7,
  cutsceneDurationSec: 3,
  cutsceneOverviewRadius: 46,
  cutsceneOverviewHeight: 26,
  cutsceneSideAngle: -0.9, // 대포 컷신과 반대쪽으로 호를 그린다
} as const;

/** 파이어볼 발사체: 가볍고 느리고 거의 직선 */
export const FIREBALL = {
  mass: 60, // kg
  radius: 0.55,
  speedMin: 25,
  speedMax: 55,
  defaultPower: 0.5,
  gravityScale: 0.15,
  maxFlightSec: 8,
  // 비주얼 (fx/FireballVisual.ts)
  coreColor: 0xffd27a,
  coreBrightness: 12, // HDR
  shellColor: 0xff5a14,
  shellScale: 1.7, // 셸 반경 / 코어 반경
  shellNoiseScale: 2.2,
  shellNoiseSpeed: 2.5,
  shellDisplace: 0.35, // 셸 반경 대비 일렁임
  shellBrightness: 3,
  lightColor: 0xff7a2a,
  lightIntensity: 400, // candela
  lightDistance: 30,
  flickerHz: 11,
  flickerAmount: 0.3,
  trailFlamesPerSec: 90,
  trailSmokePerSec: 25,
  // 체이스 카메라: 대포보다 가깝게
  chaseBack: 6.5,
  chaseUp: 2,
  chaseLead: 10,
  // 화염 폭발: 넓게, 얕게, 약하게 (BlastProfile)
  blastRadius: 6,
  blastCoreFraction: 0.12, // 반경 안쪽 이 비율까지는 무조건 분리 (대포 0.5)
  blastEdgeFraction: 0.3, // 외벽(클래딩)은 이 비율까지만 떨어져 나간다 (대포 1.0)
  blastPeakDeltaV: 4, // m/s (대포 14)
  blastHeat: 1, // 폭심 열 (FIRE.ignitionHeat 넘으면 착화)
  blastHeatRadius: 7,
  glassShatterRadius: 7, // 이 안의 유리는 열 충격으로 전부 깨진다
  flashBrightness: 6,
  postPulse: 0.45, // 충돌 펄스 세기 (대포 1)
  impactTrauma: 0.5,
} as const;

/** 화재 (destruction/FireSystem.ts, fx/Fire.ts) */
export const FIRE = {
  tickSec: 0.1, // 화재 계산 주기 (물리 시간)
  ignitionHeat: 0.55, // 이 heat 이상 + 연료가 있으면 착화
  maxBurning: 900, // 동시에 타는 조각 상한 (넘으면 새 착화 대기)
  heatDecay: 0.08, // 안 타는 조각의 heat 식는 속도 (/s)
  // 확산: 이웃에게 주는 heat/s = rate × 공유면적(m²) 비율 × 배율
  rateUp: 0.9,
  rateSide: 0.35,
  rateDown: 0.08,
  verticalThreshold: 0.5, // 이웃 방향의 |y| 성분이 이 이상이면 위/아래로 본다
  slabFactor: 0.25, // 대상이 슬래브(층 경계)면 이 배율 → 다른 층으로는 천천히
  areaRef: 0.25, // 공유 면적 기준값 (m²): 이 면적이면 rate 그대로
  spreadMultiplier: 1, // 디버그 배율
  // 연료 (초 단위 연소 시간 ≈ 연료 / burnRate)
  burnRate: 1, // 연료 소모 /s
  fuel: {
    slab: 9,
    column: 10,
    beam: 9,
    wallPanel: 10,
    window: 22, // 창대·인방·문설주 (창틀 주변 = 가연물이 많다)
    parapet: 8,
    foundation: 0,
    glass: 0,
  } as Record<string, number>,
  fuelJitter: 0.35, // 조각마다 ± 비율
  charRate: 0.12, // 타는 동안 charred 증가 /s
  // 구조 약화: 타는 조각에 붙은 엣지 용량이 초당 이 비율씩 줄어든다
  weakenRate: 0.05,
  minStrength: 0.6, // 원래 용량 대비 하한
  // 떨어져 나간 조각
  settledBurnRate: 4, // 굳은 조각은 연료를 이 배수로 빨리 태워 꺼진다
  // 대포 폭발 반경 안에 타는 조각이 있으면 주변에 열 추가 (불씨가 튐)
  cannonEmberHeat: 0.6,
  cannonEmberRadius: 5,
  // 비주얼
  sampleEmitters: 40, // 틱마다 불꽃을 뿜는 burning 조각 수
  flamesPerEmitter: 1,
  smokeEvery: 3, // 이 틱마다 한 번 연기
  maxFlames: 1500,
  maxSmoke: 600,
  maxEmbers: 800,
  flameLifeSec: 0.9,
  flameSize: 1.1,
  flameRise: 2.6,
  flameColor: 0xff8a2a,
  flameBrightness: 4, // HDR
  smokeLifeSec: 9,
  smokeSize: 2.6,
  smokeRise: 2.2,
  smokeGrowth: 4,
  smokeColor: 0x2c2724,
  smokeOpacity: 0.55,
  plumePerTick: 2, // 화재 구역 중심의 큰 연기 기둥
  plumeSize: 5,
  emberLifeSec: 2.2,
  emberSize: 0.12,
  emberSpeed: 2.5,
  emberColor: 0xffa040,
  emberBrightness: 8,
  charTint: { r: 0.2, g: 0.18, b: 0.16 }, // 다 탄(charred = 1) 조각에 곱하는 색
  crackColor: 0xff5a1a, // 갈라진 틈 불씨 emissive 색
  emberGlow: 2.2, // 불씨 emissive 세기 (HDR, 1 넘으면 Bloom)
  emberNoiseScale: 2.5, // 틈 무늬 크기 (/m)
  // 화재 라이트: burning 조각을 격자로 묶어 가장 큰 구역에
  lights: 3,
  lightCell: 4, // m
  lightIntensity: 160,
  lightDistance: 18,
  lightColor: 0xff7a30,
  lightFlickerHz: 7,
  // 관람 카메라: 화재 중심을 천천히 따라가며 줌아웃
  spectateZoomPerSec: 0.06, // 반경·높이 증가율 (/s, 처음 값 대비)
  spectateZoomMax: 1.8,
  spectateFollowSec: 1.5, // 중심 추적 스무딩 시간상수
} as const;

/** 손상 외관·느슨한 조각 (destruction/DamageModel.ts, DamageView.ts) */
export const DAMAGE_VISUAL = {
  enabled: true, // 외관 효과 (틈·처짐·균열·열화·흔들림). 끄면 원래 자리로
  updateSec: 0.2, // damage 재계산 주기 (물리 시간)
  changeEpsilon: 0.02, // 이보다 작은 damage 변화는 무시 (재배치·텍스처 업로드 안 함)
  // damage = w1·끊긴 연결 면적 비율 + w2·엣지 누적손상 평균 + w3·화재 약화 평균
  weightBroken: 1.3,
  weightStrain: 0.5,
  weightFire: 0.6,
  // 틈·처짐·기울어짐 (fixed 바디와 렌더를 같이 옮긴다)
  gapMax: 0.05, // m: 끊긴 이웃에게서 멀어지는 거리 (damage 1일 때)
  sagMax: 0.08, // m: 아래 지지를 잃으면 처지는 거리
  tiltMax: 0.06, // rad: 외장재가 바깥으로 기우는 각
  maxTeleportsPerFrame: 300, // 한 프레임에 옮기는 조각 상한
  // 셰이더
  crackWidth: 0.35, // 경계(rim) 쪽 어둡게 할 폭 (damage 1일 때 rim 비율)
  crackStrength: 0.85,
  crackNoiseScale: 7, // /m
  grimeStrength: 0.55, // 먼지·그을음 톤 섞는 정도
  edgeNormalNoise: 0.6, // 경계 근처 노멀 흔들기
  swayAmplitude: 0.006, // m: 매달린 조각 흔들림 (불변 조건 1cm 이하)
  swayHz: 1.3,
  // 느슨한 조각 낙하
  looseFactor: 1.5, // 남은 엣지 강도 합 < 자기 무게 × 이 값이면 떨어진다
  looseMaxEdges: 1, // 남은 엣지가 이 이하이고
  looseDamage: 0.85, // damage가 이 이상이어도 떨어진다
  maxLooseDropsPerStep: 2, // 한 물리 스텝에 떨어뜨리는 상한 (한꺼번에 몰리지 않게)
  looseWakeRange: 1.3, // 폭발 반경 × 이 값 안의 손상 조각은 작은 충격에도 떨어진다
  looseWakeDamage: 0.6, // 위 범위에서 이 damage 이상이면
  chainDamage: 0.7, // 잔해에 부딪힌 조각이 이 damage 이상이면 에너지와 무관하게 떨어진다
  // 이미 손상된 곳을 맞혔을 때
  damagedCoreBoost: 0.35, // 코어 반경 비율에 + damage × 이 값 (손상 조각은 더 넓게 떨어져 나간다)
  penetrationDamageFactor: 0.7, // 관통 저항 × (1 - 이 값 × 주변 damage)
  penetrationSampleRadius: 1.5, // 주변 damage 표본 반경 (m)
  // 철근 노출
  rebarMax: 512,
  rebarMinGap: 0.03, // m: 구조재 사이 틈이 이보다 크면
  rebarLength: 0.5,
  rebarRadius: 0.012,
  rebarColor: 0x5a4636,
  // 디버그
  invariantCheckSec: 1, // GUI 불변 조건 검사 주기 (실제 시간)
  colliderOverlaySec: 0.25,
  inPlaceDistance: 0.02, // 불변 조건: 원래 자리로 보는 거리 (m)
  maxRenderError: 0.01, // 불변 조건: 렌더 ↔ 콜라이더 오차 (m)
} as const;

/** 경제: 파편 = 돈 (src/economy/, Phase 7-1) */
export const ECONOMY = {
  // 재질 단가 ($/kg). 부재 종류(kind)가 우선, 없으면 재질로. 0이면 수익 없음 + 파괴율 계산에서도 빠진다
  pricePerKg: {
    concrete: 0.004,
    glass: 0.08, // 얇아서 가볍지만 비싸다
  } as Record<string, number>,
  kindPricePerKg: {
    foundation: 0, // 기초는 돈도 파괴율도 아님
  } as Record<string, number>,
  minValue: 1, // 아무리 작은 조각도 최소 이만큼 ($, 단가 0인 조각 제외)
  orderMultiplier: 1, // 주문 배율 (7-3 주문이 정한다)
  // 희귀 파편 (훅만, 기본 꺼짐). 건물 seed로 결정 → 같은 건물이면 같은 조각이 희귀
  rareEnabled: false,
  rareChance: 0.004,
  rareMultiplier: 15,
  rareSalt: 0x9e3779b9, // 건물 seed와 섞는 값
  rareColor: { r: 1.35, g: 1.05, b: 0.35 }, // 금빛 바탕색 (조각 색에 곱한다)
  completionThreshold: 0.85, // 파괴율 바의 임계값 표시 (7-2 완파 피날레)
  // +$ 팝업 (fx/MoneyPopups.ts)
  popupBinSec: 0.2, // 이 시간 동안 같은 화면 셀의 수익을 묶어 하나로
  popupCellPx: 140, // 화면 공간 셀 크기
  popupWorldCellM: 1.5, // 지급을 먼저 이 크기 월드 격자로 모아 프레임당 셀마다 한 번만 화면 투영
  popupMax: 24, // 동시에 떠 있는 최대 수 (풀)
  popupLifeSec: 1.3,
  popupRisePx: 70,
  popupBigAmount: 500, // 이 이상이면 크게 강조
  popupMaxScale: 2.6,
  // HUD 돈 카운터가 굴러가는 속도
  counterSmoothingSec: 0.35, // 지수 스무딩 시간상수
  counterMinSpeed: 30, // $/s: 작은 차이도 이 속도 이상으로 따라간다
} as const;

/** 포인트 라이트 풀 (fx/LightPool.ts): 개수가 바뀌면 모든 재질 셰이더가 다시 컴파일되므로 고정 */
export const LIGHT_POOL = {
  size: 5,
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
  intactSafety: 2.0,
  failureTime: 1.0, // 과부하율이 tolerance보다 1 큰 엣지가 끊기기까지 걸리는 시간 (s)
  overloadTolerance: 1.2, // 이 과부하율까지는 손상이 쌓이지 않는다 (가벼운 과부하는 버팀)
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
  chainJoulesPerKg: 1.0,
  chainMinSpeed: 4, // 이보다 느린 충돌은 검사하지 않는다 (m/s)
  chainMinMass: 40, // kg: 이보다 가벼운 잔해(유리 파편·작은 조각)는 연쇄 파괴를 일으키지 않는다
  wakeMargin: 1, // 덩어리가 떨어질 때 그 AABB + 이 여유 안의 굳은 잔해를 다시 깨운다 (m)
  // 폭발 반경 × rubbleRange 안에서 처음 연결 면적의 이 비율도 안 남은 조각은 완전히 떼어낸다
  // (같은 곳을 여러 번 쏘면 거의 다 부서진 잔재가 매달려 다음 포탄을 막지 않게)
  rubbleFraction: 0.35,
  rubbleRange: 1.5,
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

/**
 * 엑스레이 킬캠 (game/XRayKillCam.ts): 관통할 만큼 강한 포탄이 건물에 맞기 직전부터
 * 아주 느린 슬로모션 + 건물을 투시해 포탄이 파고드는 과정을 보여준다 (Sniper Elite X-Ray Kill Cam 참고).
 */
export const XRAY = {
  timeScale: 0.03, // 킬캠 중 물리 시간 배속 (일반 hit-stop 0.15보다 5배 느림)
  approachRealSec: 1, // 충돌 이만큼(실제 시간) 전부터 시작: 레이 길이 = 속도 × 이 값 × timeScale
  holdSec: 1.2, // 마지막 관통 폭발 뒤 투시 화면을 유지하는 시간 (실제)
  maxSec: 8, // 킬캠 최대 길이 (실제, 안전장치)
  skipTimeScale: 1, // 클릭/Space로 건너뛰면 이 배속으로 마저 진행
  refreshSec: 0.08, // 손상 조각 색을 다시 칠하는 주기 (실제)
  // 투시 화면 색 (조각별 RGBA)
  ghostColor: 0x6fb6ff,
  ghostAlpha: 0.1,
  glassAlpha: 0.03,
  hotColor: 0xff9a3c, // 구조에서 떨어져 나간(맞은) 조각
  hotAlpha: 1,
  background: 0x07101c,
  shellColor: 0xffe08a,
  trailColor: 0xffb347,
  // 카메라: 관통 경로 옆에서 천천히 돌며 포탄을 따라간다
  blendSec: 0.5,
  camDistance: 13, // + 관통 깊이의 절반
  camHeight: 3,
  camBehind: 0.35, // 거리 대비 진행 반대쪽으로 물러나는 비율 (포탄이 들어오는 게 보이게)
  camOrbit: 0.5, // 킬캠 동안 도는 각 (rad)
  camOrbitSec: 4, // 위 각을 도는 데 걸리는 실제 시간
  camTrack: 0.6, // 바라보는 점: 경로 중심(0) ↔ 포탄(1)
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
  shadowCameraSize: 30, // 방향광 그림자 카메라 반경 (포커스가 없을 때)
  // 동적 그림자 범위 (fx/ShadowFit.ts): 건물 + 움직이는 잔해를 감싸는 반경을 이 사이로 자른다
  shadowMinSize: 14,
  shadowMaxSize: 60,
  shadowMargin: 3, // 포커스 박스 바깥 여유 (m)
  shadowSmoothingSec: 0.25, // 범위 변화 지수 스무딩 시간상수
  shadowLightDistance: 80, // 포커스 중심에서 광원까지 거리 (그림자 카메라 near/far 기준)
  // 법선 방향 오프셋(m). 조각 이음매에서 표면 바로 아래 단면이 그림자 맵에 찍혀 생기는 줄무늬(acne) 방지
  shadowNormalBias: 0.03,
  maxPixelRatio: 2,
  exposure: 0.72, // HDRI 하늘 + 태양 기준. 1이면 햇빛 받는 지면이 하얗게 날아간다
  fov: 50,
  near: 0.1,
  far: 1000,
} as const;

export const LIGHTING = {
  background: 0x9fb4c8, // HDRI가 없을 때
  sunColor: 0xfff1e0,
  sunIntensity: 3,
  sunDirection: { x: 20, y: 35, z: 15 }, // 태양 쪽 방향 (크기 무관)
  hemiSkyColor: 0xbcd4ff,
  hemiGroundColor: 0x5a5046,
  hemiIntensity: 1, // HDRI가 없을 때
  // HDRI(pure sky)는 아래 반구가 비어 지면 반사광이 없다 → 반구광을 지면 반사 대용으로:
  // 위는 어둡게(하늘은 HDRI가 준다), 아래는 햇빛 받은 지면 색. 이게 없으면 그늘 벽이 거의 검다
  bounceSkyColor: 0x202428,
  bounceGroundColor: 0xb8a68c,
  bounceIntensity: 3.5, // 세로 벽은 아래 반구의 절반만 받아서 꽤 세야 한다
  environmentIntensity: 1.2,
  backgroundBlurriness: 0.02,
  backgroundIntensity: 1,
  fogColor: 0xc4ccd4, // 지면 끝이 지평선에 녹아들게
  fogDensity: 0.005, // FogExp2: 60m ≈ 9%, 300m ≈ 90%
} as const;

/** 먼지 구름 (fx/Dust.ts) */
export const DUST = {
  maxPuffs: 512, // 풀 크기 (링 버퍼)
  color: 0xb5ab9c,
  // 폭발: 반경 r에 대해 퍼프 수 = blastPuffsPerMeter × r, 반경 방향 속도 blastSpeed × (0.4~1)
  blastPuffsPerMeter: 14,
  blastSpeed: 7,
  blastLifeSec: 9,
  blastSize: 3, // 시작 크기 (m), 사는 동안 growth배까지
  // 조각이 지면에 부딪힘: minImpactSpeed 이상, 퍼프 수 = 1 + 질량 비례(최대 groundMaxPuffs)
  minImpactSpeed: 3, // m/s
  groundPuffsPerTonne: 2,
  groundMaxPuffs: 4,
  groundSpeed: 2.5,
  groundLifeSec: 6,
  groundSize: 1.8,
  maxGroundImpactsPerFrame: 6, // 한 프레임에 이펙트를 일으키는 지면 충돌 수 상한
  growth: 3.5,
  drag: 1.4, // 공기 저항 (1/s)
  rise: 0.35, // 떠오르는 속도 (m/s)
  opacity: 0.7,
  fadeExponent: 1.2, // 알파 = (1 - 수명비)^이 값
  nearFade: 4, // 카메라 이 거리(m) 안쪽은 옅게 (화면을 가리지 않게)
  // 근사 조명: 퍼프 위쪽/아래쪽 밝기 배수 (HDR 장면 밝기에 맞춘 값)
  lightTop: 2.2,
  lightBottom: 0.9,
  maxPuffsPerBlast: 80,
} as const;

/** 시각 전용 부스러기 + 폭발 섬광 (fx/Sparks.ts). 물리 없음, 정점 셰이더에서 탄도 계산. */
export const SHARDS = {
  maxShards: { low: 2000, medium: 4000, high: 8000 },
  sizeMin: 0.06, // m
  sizeMax: 0.28,
  color: 0x9c968c,
  blastPerMeter: 70, // 폭발 반경 1m당 부스러기 수
  blastSpeed: 16, // m/s (반경 방향, × 0.3~1)
  upwardBias: 0.5,
  groundPerImpact: 6,
  groundSpeed: 4,
  glassPerFragment: 3, // 유리 조각 하나가 떨어져 나갈 때
  glassColor: 0xcfe6f2,
  lifeSec: 7, // 이후 작아지며 사라진다
  shrinkSec: 1,
  spin: 12, // rad/s 최대
  gravity: 9.81,
  restitution: 0.25, // 지면에 한 번 튀는 속도 비율
  // 섬광: 폭발 지점 HDR 점광 + 가산 구 (Bloom이 잡는다)
  flashSec: 0.18,
  flashLightIntensity: 1500, // candela (physical lights, 거리 제곱 감쇠)
  flashLightDistance: 40,
  flashColor: 0xffc27a,
  flashBrightness: 8, // 스프라이트 색 배수 (HDR, 1 넘으면 Bloom)
  flashSizePerRadius: 2.5, // 섬광 스프라이트 지름 = 폭발 반경 × 이 값
} as const;

/** 포스트 처리 (fx/PostFX.ts) */
export const POSTFX = {
  enabled: true,
  ao: true,
  aoRadius: 2, // m
  aoIntensity: 2.5,
  aoDistanceFalloff: 1,
  aoHalfRes: true,
  aoQuality: 'Medium' as 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra',
  smaa: true,
  bloom: true,
  bloomIntensity: 0.6,
  bloomThreshold: 1.1, // 톤매핑 전 HDR 휘도. 섬광처럼 1 넘는 것만
  bloomSmoothing: 0.2,
  vignette: true,
  vignetteOffset: 0.3,
  vignetteDarkness: 0.55,
  // 충돌 펄스: 방사형 블러 + 색수차가 pulseSec 동안 감쇠
  impactPulse: true,
  pulseSec: 0.45,
  pulseBlur: 0.06, // 화면 중심 쪽으로 늘이는 비율 (UV)
  pulseAberration: 0.012, // UV
  pulseSamples: 10,
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

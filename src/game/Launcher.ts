// 발사대 공통 인터페이스: 대포(Cannon)와 마법사(Wizard)가 구현한다.
// Game과 카메라는 이 인터페이스만 보고 컷신 → 조준 → 발사 → 발사체 시점을 돌린다.
// 조준 방향·발사 위치는 등장 애니메이션과 무관한 '다 나온 자세' 기준이다
// (컷신 끝 자세, 예상 궤적, 실제 발사가 항상 같은 값을 쓰도록).
import type { Object3D, Vector3 } from 'three';

export type LauncherId = 'cannon' | 'wizard';

export interface AimLimits {
  yawLimit: number;
  pitchMin: number;
  pitchMax: number;
}

export interface PowerRange {
  /** 파워 0일 때 발사 속도 (m/s) */
  speedMin: number;
  /** 파워 1일 때 */
  speedMax: number;
  defaultPower: number;
}

/** 발사체 물리 특성 */
export interface ProjectileSpec {
  kind: 'shell' | 'fireball';
  mass: number;
  radius: number;
  /** 중력 배수 (1 = 보통, 작을수록 직선에 가깝게) */
  gravityScale: number;
  /** 이만큼 날아도 아무것도 안 맞으면 빗나간 것으로 (s) */
  maxFlightSec: number;
}

/** 컷신 카메라: 지금 위치 → 건물 전경 → 조준 자세 */
export interface CutsceneSpec {
  durationSec: number;
  overviewRadius: number;
  overviewHeight: number;
  /** 전경 지점을 발사대 방향에서 옆으로 돌리는 각 (rad) */
  sideAngle: number;
}

/** 조준 카메라: 발사대 회전축 기준 뒤·위·옆, 바라보는 점은 조준 방향 앞 */
export interface AimCameraSpec {
  back: number;
  up: number;
  ahead: number;
  /** 오른쪽(+)으로 비키는 거리 — 어깨 너머 시점 */
  side: number;
}

/** 체이스 카메라: 발사체 뒤·위, 진행 방향 앞을 바라봄 */
export interface ChaseSpec {
  back: number;
  up: number;
  lead: number;
}

export interface Launcher {
  readonly id: LauncherId;
  readonly root: Object3D;
  /** 건물 쪽 기본 방위각 (+z 기준 y축 회전) */
  readonly baseYaw: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly limits: AimLimits;
  readonly power: PowerRange;
  readonly projectile: ProjectileSpec;
  /** 발사 버튼 → 실제 발사까지 충전 시간 (s). 0이면 즉시 */
  readonly chargeSec: number;
  readonly cutscene: CutsceneSpec;
  readonly aimCamera: AimCameraSpec;
  readonly chase: ChaseSpec;
  /** 발사 순간 카메라 흔들림 (trauma 0~1) */
  readonly fireTrauma: number;
  /** 등장 애니메이션이 끝났는지 */
  readonly ready: boolean;

  /** 등장 애니메이션 시작 (이미 나와 있으면 무시) */
  appear(): void;
  /** 등장 애니메이션 건너뛰기 */
  finishAppear(): void;
  /** 즉시 숨긴다 (다음 컷신에서 다시 등장) */
  hide(): void;
  /** 각도 제한 안으로 조준 */
  setAim(yaw: number, pitch: number): void;
  /** 회전축 (다 나온 자세, 월드) */
  pivotWorld(out: Vector3): Vector3;
  /** 조준 방향 단위 벡터 (월드) */
  aimDirection(out: Vector3): Vector3;
  /** 발사체가 나가는 곳 (다 나온 자세, 월드) */
  muzzleWorld(out: Vector3): Vector3;
  /** 충전 연출 시작 (chargeSec 동안) */
  beginCharge(): void;
  /** 발사 연출 (반동, 섬광 등) */
  fire(): void;
  /** 렌더 프레임마다 (실제 시간) */
  update(dt: number): void;
}

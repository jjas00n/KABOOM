// 발사체 추적 체이스 카메라: 진행 방향 뒤·위에서 지수 스무딩으로 조금 늦게 따라간다.
// 거리는 발사체별 ChaseSpec. 발사체가 사라지면(충돌) 마지막 자세에서 멈춰 그 지점을 바라본다.
import { Vector3, type PerspectiveCamera } from 'three';
import { CAMERA } from '../config';
import type { ChaseSpec } from '../game/Launcher';
import type { CameraController, CameraPose } from './CameraRig';
import { smoothing } from './easing';

/** 추적 대상: 위치와 속도만 알면 된다 */
export interface ChaseTarget {
  /** 대상이 아직 날고 있으면 true */
  readonly active: boolean;
  readonly position: Vector3;
  velocity(out: Vector3): Vector3;
}

/** 대포탄 체이스 (기본값) */
export const DEFAULT_CHASE: ChaseSpec = {
  back: CAMERA.chaseBack,
  up: CAMERA.chaseUp,
  lead: CAMERA.chaseLead,
};

const velocity = new Vector3();
const desired = new Vector3();
const UP = new Vector3(0, 1, 0);

export class ChaseCam implements CameraController {
  private readonly position = new Vector3();
  private readonly look = new Vector3();
  private readonly direction = new Vector3(0, 0, -1);
  private target: ChaseTarget | null = null;
  private spec: ChaseSpec = DEFAULT_CHASE;

  /** 지금 카메라 위치에서 추적 시작 (튀지 않게) */
  start(target: ChaseTarget, from: Vector3, spec: ChaseSpec = DEFAULT_CHASE): void {
    this.target = target;
    this.spec = spec;
    this.position.copy(from);
    this.look.copy(target.position);
  }

  update(dt: number, _camera: PerspectiveCamera, out: CameraPose): void {
    const t = this.target;
    if (t?.active) {
      t.velocity(velocity);
      if (velocity.lengthSq() > 1e-6) this.direction.copy(velocity).normalize();
      desired
        .copy(t.position)
        .addScaledVector(this.direction, -this.spec.back)
        .addScaledVector(UP, this.spec.up);
      const k = smoothing(dt, CAMERA.chaseSmoothing);
      this.position.lerp(desired, k);
      desired.copy(t.position).addScaledVector(this.direction, this.spec.lead);
      this.look.lerp(desired, k);
    }
    out.position.copy(this.position);
    out.target.copy(this.look);
  }
}

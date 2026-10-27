// 조준 카메라: 발사대 회전축 뒤·위(·옆) 3인칭. 조준과 함께 돈다.
// 대포는 포신 바로 뒤, 마법사는 오른쪽 어깨 너머 (Launcher.aimCamera의 side).
// 뒤로 물러나는 방향은 수평 방향만 쓴다 (높이 조준해도 카메라가 땅으로 파고들지 않게).
import { Vector3, type PerspectiveCamera } from 'three';
import type { Launcher } from '../game/Launcher';
import type { CameraController, CameraPose } from './CameraRig';

const pivot = new Vector3();
const dir = new Vector3();
const flat = new Vector3();

export class AimCam implements CameraController {
  /** 지금 조준 중인 발사대 */
  constructor(public launcher: Launcher) {}

  /** 발사대의 (다 나온 자세) 현재 조준에 맞는 자세 */
  poseFor(out: CameraPose): CameraPose {
    const l = this.launcher;
    const spec = l.aimCamera;
    l.pivotWorld(pivot);
    l.aimDirection(dir);
    flat.set(dir.x, 0, dir.z).normalize();
    // 오른쪽 = 진행 방향 × 위 = (-z, 0, x)
    out.position
      .copy(pivot)
      .addScaledVector(flat, -spec.back)
      .add(flat.set(-flat.z, 0, flat.x).multiplyScalar(spec.side));
    out.position.y += spec.up;
    out.target.copy(pivot).addScaledVector(dir, spec.ahead);
    return out;
  }

  update(_dt: number, _camera: PerspectiveCamera, out: CameraPose): void {
    this.poseFor(out);
  }
}

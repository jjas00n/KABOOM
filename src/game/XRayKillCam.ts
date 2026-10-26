// 엑스레이 킬캠 (Sniper Elite의 X-Ray Kill Cam 참고)
// 관통할 만큼 강한 포탄이 건물에 맞기 직전부터:
//   아주 느린 슬로모션(XRAY.timeScale) + 건물 투시(XRayView) + 경로 옆 카메라(KillCam) + 빛나는 포탄·궤적
// 마지막 관통 폭발 뒤 holdSec 동안 보여주고 원래대로. 클릭/Space로 건너뛸 수 있다.
import { Vector3, type Scene } from 'three';
import type { CameraRig } from '../camera/CameraRig';
import { KillCam } from '../camera/KillCam';
import { XRAY } from '../config';
import { XRayView } from '../fx/XRayView';
import type { BuildingSite } from './BuildingSite';
import type { TimeControl } from './Game';
import type { Projectile } from './Projectile';

export class XRayKillCam {
  private readonly view: XRayView;
  private readonly cam = new KillCam();
  private site: BuildingSite | null = null;
  private running = false;
  private elapsed = 0;
  private refreshLeft = 0;
  /** 관통이 끝난 뒤 남은 유지 시간 (끝나기 전엔 Infinity) */
  private holdLeft = Infinity;
  private skipped = false;
  private savedTimeScale = 1;
  private readonly trailStart = new Vector3();

  constructor(
    scene: Scene,
    private readonly rig: CameraRig,
    private readonly time: TimeControl,
    private readonly projectile: Projectile,
  ) {
    this.view = new XRayView(scene);
  }

  get active(): boolean {
    return this.running;
  }

  /** contact: 충돌(예상) 지점, dir: 진행 방향(단위), depth: 관통 깊이 */
  start(site: BuildingSite, contact: Vector3, dir: Vector3, depth: number): void {
    const d = site.destruction;
    if (this.running || !d) return;
    this.running = true;
    this.site = site;
    this.elapsed = 0;
    this.refreshLeft = 0;
    this.holdLeft = Infinity;
    this.skipped = false;
    this.savedTimeScale = this.time.timeScale;
    this.time.timeScale = XRAY.timeScale;
    this.trailStart.copy(this.projectile.position);
    this.view.enable(d, site.fragmentMaterials);
    this.cam.start(contact, dir, depth, this.rig.camera.position, this.projectile);
    this.rig.setController(this.cam, XRAY.blendSec);
    this.projectile.setGlow(true);
  }

  /** 관통 폭발이 다 터졌다: 잠깐 보여주고 끝낸다 */
  finishDrilling(): void {
    if (!this.running || this.holdLeft !== Infinity) return;
    this.holdLeft = this.skipped ? 0 : XRAY.holdSec;
  }

  /** 클릭/Space: 남은 과정을 빠르게 돌리고 끝낸다 */
  skip(): void {
    if (!this.running) return;
    this.skipped = true;
    this.time.timeScale = XRAY.skipTimeScale;
    if (this.holdLeft !== Infinity) this.holdLeft = 0;
  }

  /** 렌더 프레임마다 (실제 시간) */
  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt;
    this.refreshLeft -= dt;
    if (this.refreshLeft <= 0) {
      this.view.refresh();
      this.refreshLeft = XRAY.refreshSec;
    }
    this.view.setTrail(this.trailStart, this.projectile.position);
    if (this.holdLeft !== Infinity) this.holdLeft -= dt;
    if (this.holdLeft <= 0 || this.elapsed > XRAY.maxSec) this.stop();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const site = this.site;
    this.view.disable(() => site?.restoreColors());
    this.time.timeScale = this.savedTimeScale;
    this.projectile.setGlow(false);
    this.site = null;
  }
}

// 완파 피날레 연출 시간표 (Game의 FINALE·RESULT 상태가 쓴다). 실제 정리·정산은 Finale이 한다.
//   impact   (실제 hitStopSec)  거의 정지 + 'DEMOLISHED!' + 강한 흔들림 + 균열 확산·진동 시작
//   collapse (물리 시간)        슬로모션, 위→아래 붕괴 웨이브 (Finale.stepCollapse), 시네마틱 궤도 카메라
//   outro    (실제 outroSec)    정상 속도로 잔해가 가라앉는 걸 보고 → onDone (RESULT)
// 클릭/Space 스킵: 남은 조각을 한 번에 정리하고 바로 onDone.
import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraRig } from '../camera/CameraRig';
import type { SpectateCam } from '../camera/SpectateCam';
import { FINALE } from '../config';
import type { Economy } from '../economy/Economy';
import type { MoneyPopups } from '../fx/MoneyPopups';
import type { PostFX } from '../fx/PostFX';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { FinaleBanner, ResultScreen } from '../ui/ResultScreen';
import type { BuildingSite } from './BuildingSite';
import { Finale } from './Finale';
import type { TimeControl } from './Game';

type Phase = 'off' | 'impact' | 'collapse' | 'outro';

export interface FinaleDeps {
  site: BuildingSite;
  physics: PhysicsWorld;
  economy: Economy;
  time: TimeControl;
  rig: CameraRig;
  camera: PerspectiveCamera;
  postfx: PostFX;
  orbit: OrbitControls;
  orbitCam: SpectateCam;
  popups: MoneyPopups;
  /** 연출 끝 (→ RESULT) */
  onDone: () => void;
  /** 결과 화면 '다음 주문' */
  onNext: () => void;
}

export class FinaleDirector {
  private phase: Phase = 'off';
  private finale: Finale | null = null;
  /** 지금 단계에서 지난 실제 시간 */
  private t = 0;
  /** 피날레 시작 후 실제 시간 (균열 확산·진동) */
  private since = 0;
  private savedTimeScale = 1;
  private readonly banner = new FinaleBanner();
  private readonly result: ResultScreen;
  private readonly center = new Vector3();

  constructor(private readonly deps: FinaleDeps) {
    this.result = new ResultScreen(deps.onNext);
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** 시작: 정산 + 연출 준비. center = 건물 중심 (카메라가 돈다) */
  start(center: Vector3): void {
    const { site, physics, economy, time, rig, postfx, orbit, orbitCam, popups } = this.deps;
    const d = site.destruction;
    if (!d) return;
    const effects = site.effects;
    this.finale = new Finale(d, physics, economy, {
      burst: (at, velocity, size, color) => effects.burst.emit(at, velocity, size, color),
      dust: (c, r) => effects.dust.blast(c, r),
    });
    const reward = this.finale.begin();
    popups.showBig(reward.finale + reward.bonus, 'Demolition complete · finale + bonus');
    site.finaleActive = true;
    this.savedTimeScale = time.timeScale;
    time.timeScale = FINALE.hitStopScale;
    this.phase = 'impact';
    this.t = 0;
    this.since = 0;
    this.banner.show();
    rig.shake.add(FINALE.shakeTrauma);
    postfx.pulse();
    this.center.copy(center);
    orbit.enabled = false;
    orbitCam.start(this.center, rig.camera.position, {
      radius: FINALE.cinematicRadius,
      height: FINALE.cinematicHeight,
      speed: FINALE.cinematicSpeed,
      autoSec: Infinity,
      zoomPerSec: FINALE.cinematicZoomPerSec,
      zoomMax: 1.6,
    });
    rig.setController(orbitCam);
  }

  /** 물리 스텝마다 */
  step(dt: number): void {
    const f = this.finale;
    if (!f) return;
    if (this.phase === 'collapse') f.stepCollapse(dt);
    else f.drainRemovals(FINALE.removalsPerStep);
    // 숨긴 조각의 바디까지 다 지워야 불변 조건 검사를 다시 켠다
    if (this.phase === 'off' && f.pendingRemovals === 0) this.deps.site.finaleActive = false;
  }

  /** 렌더 프레임마다 (실제 시간) */
  update(dt: number): void {
    if (this.phase === 'off') return;
    const { site, time, rig } = this.deps;
    this.t += dt;
    this.since += dt;
    // 균열이 1까지 번지고, 그동안 건물이 떨린다
    const ramp = Math.min(1, this.since / FINALE.crackRampSec);
    site.setFinaleLook(ramp, FINALE.quakeAmplitude * (1 - ramp));
    switch (this.phase) {
      case 'impact':
        if (this.t >= FINALE.hitStopSec) {
          this.phase = 'collapse';
          this.t = 0;
          time.timeScale = FINALE.slowMotion;
          rig.shake.add(FINALE.shakeTrauma * 0.5);
        }
        break;
      case 'collapse':
        if (this.finale?.collapsed) {
          this.phase = 'outro';
          this.t = 0;
          time.timeScale = this.savedTimeScale;
        }
        break;
      case 'outro':
        if (this.t >= FINALE.outroSec) this.finish();
        break;
    }
  }

  /** 클릭/Space: 남은 붕괴를 한 번에 끝내고 결과로 */
  skip(): void {
    if (this.phase === 'off') return;
    this.finale?.finishNow();
    this.finish();
  }

  showResult(data: Parameters<ResultScreen['show']>[0]): void {
    this.deps.orbit.enabled = true;
    this.result.show(data);
  }

  /** 다음 건물로: 화면 정리 */
  reset(): void {
    this.result.hide();
    this.banner.hide();
    this.phase = 'off';
    this.finale = null;
  }

  private finish(): void {
    const { site, time } = this.deps;
    this.phase = 'off';
    time.timeScale = this.savedTimeScale;
    site.setFinaleLook(1, 0);
    this.banner.hide();
    this.deps.onDone();
  }
}

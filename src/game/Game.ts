// 게임: 건물 + 발사대(대포·마법사) + 발사체 + 카메라를 상태 머신(StateMachine)으로 잇는다.
// 모든 단계는 fsm.launcher(지금 고른 발사대) 기준으로 동작한다.
//   IDLE            건물 전경을 천천히 돈다 (드래그로 둘러보기). [Cannon] [Wizard]
//   CUTSCENE        발사대가 등장하고 카메라가 건물 → 발사대 뒤로 날아간다. 클릭/Space 스킵
//   AIMING          드래그/WASD 조준, 휠/QE 파워, 예상 궤적 점선. Space/클릭 발사
//                   (마법사는 chargeSec 동안 입력을 잠그고 충전한 뒤 발사)
//   PROJECTILE_CAM  체이스 캠. 처음 부딪힌 곳에서 IMPACT (아무것도 안 맞으면 SPECTATE)
//   IMPACT          대포: 관통 폭발(+킬캠), 파이어볼: 화염 폭발 + 화재. hit-stop + 흔들림
//   SPECTATE        충돌 지점 자동 회전 → 자유 관람 (화재면 불 중심을 따라 줌아웃).
//                   [Cannon]/[Wizard] 재발사 / [Back] 처음 화면 / [Reset] 건물 재생성
import { Vector3, type PointLight } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AimCam } from '../camera/AimCam';
import { CameraRig, type CameraPose } from '../camera/CameraRig';
import { ChaseCam } from '../camera/ChaseCam';
import { CutsceneCam } from '../camera/CutsceneCam';
import { SpectateCam } from '../camera/SpectateCam';
import {
  CAMERA,
  CANNON,
  DAMAGE_VISUAL,
  ECONOMY,
  FIRE,
  FIREBALL,
  HIT_STOP,
  PROJECTILE,
  SANDBOX,
  XRAY,
} from '../config';
import type { Assets } from '../core/Assets';
import type { Renderer } from '../core/Renderer';
import { FireballVisual } from '../fx/FireballVisual';
import type { PostFX } from '../fx/PostFX';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import { Stage } from '../sandbox/Stage';
import { Economy } from '../economy/Economy';
import { MATERIAL } from '../fracture/Fragment';
import { MoneyPopups } from '../fx/MoneyPopups';
import { EconomyHud } from '../ui/EconomyHud';
import { HUD } from '../ui/HUD';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { muzzleSpeed } from './ballistics';
import { penetrationBlasts, penetrationDepth, type Blast } from './penetration';
import { BuildingSite } from './BuildingSite';
import { Cannon } from './Cannon';
import { FIREBALL_SPEC } from './fireball';
import type { Launcher, LauncherId } from './Launcher';
import { Projectile, type ProjectileHit } from './Projectile';
import { GameState, StateMachine } from './StateMachine';
import { TrajectoryLine } from './TrajectoryLine';
import { Wizard } from './Wizard';
import { XRayKillCam } from './XRayKillCam';

/** hit-stop이 물리 시간을 늦추는 대상 (Loop의 FixedStepper) */
export interface TimeControl {
  timeScale: number;
}

const AIM_KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  powerDown: ['KeyQ'],
  powerUp: ['KeyE'],
} as const;

export class Game {
  readonly site: BuildingSite;
  readonly fsm = new StateMachine(GameState.IDLE);
  readonly rig: CameraRig;
  readonly launchers: Record<LauncherId, Launcher>;
  readonly stage: Stage;
  /** 건물이 준비됐는지 (생성 중엔 발사대 못 씀) */
  ready = false;

  /** 발사대별 발사체 (대포탄 / 파이어볼) */
  private readonly projectiles: Record<LauncherId, Projectile>;
  /** 발사대별 파워 0~1 (디버그 GUI도 바꾼다) */
  readonly powers: Record<LauncherId, number>;
  private readonly hud: HUD;
  private readonly postfx: PostFX;
  private readonly orbit: OrbitControls;
  private readonly orbitCam: SpectateCam;
  private readonly aimCam: AimCam;
  private readonly chaseCam = new ChaseCam();
  private cutscene: CutsceneCam | null = null;
  private readonly trajectory: TrajectoryLine;

  private readonly buildingCenter = new Vector3(0, 0, 0);
  private readonly impactPoint = new Vector3();
  private pendingHit: ProjectileHit | null = null;
  /** 포탄이 건물(조각)에 맞았는지. 땅에 맞으면 관통하지 않는다 */
  private hitBuilding = false;
  /** 관통 경로의 아직 안 터진 폭발 (delay 오름차순), 첫 충돌 뒤 경과 물리 시간 */
  private blasts: Blast[] = [];
  private nextBlast = 0;
  private drillTime = 0;
  private readonly drillFrom = new Vector3();
  private readonly drillDir = new Vector3();
  private drillSpeed = 0;
  private drillDepth = 0;
  private readonly blastPoint = new Vector3();
  private hitStopLeft = 0;
  private savedTimeScale = 1;
  /** 이번 충돌에서 일반 hit-stop을 걸었는지 (킬캠이면 킬캠이 시간을 쥔다) */
  private hitStopApplied = false;
  private readonly killCam: XRayKillCam;
  private readonly flightVelocity = new Vector3();

  private readonly fireballVisual: FireballVisual;
  /** 파편 = 돈: 지갑·배율·건물 장부 (건물이 바뀌어도 지갑은 유지) */
  readonly economy = new Economy();
  /** 성능 측정: 이번 프레임 경제(지급 + 팝업)에 쓴 시간 (ms) */
  readonly economyStats = { ms: 0 };
  private readonly popups: MoneyPopups;
  private readonly ecoHud: EconomyHud;
  /** 파이어볼을 따라다니는 라이트 (풀에서 빌림) */
  private fireballLight: PointLight | null = null;
  /** 충전 남은 시간 (s). 음수면 충전 중 아님 */
  private chargeLeft = -1;
  /** 마지막 충돌이 파이어볼이었는지 (관람 카메라가 불을 따라간다) */
  private fireSpectate = false;
  /** 파이어볼 꼬리 불꽃 방출 누적 */
  private trailAcc = 0;
  /** 실제 경과 시간 (셰이더 일렁임·깜빡임) */
  private clock = 0;

  private readonly keys = new Set<string>();
  private pointer: { x: number; y: number; startX: number; startY: number } | null = null;
  private readonly muzzle = new Vector3();
  private readonly launchVelocity = new Vector3();
  private readonly aimPose: CameraPose = { position: new Vector3(), target: new Vector3() };

  constructor(
    renderer: Renderer,
    physics: PhysicsWorld,
    private readonly time: TimeControl,
    loading: LoadingOverlay,
    assets: Assets | null = null,
  ) {
    const { scene, camera, canvas } = renderer;
    this.postfx = renderer.postfx;
    this.stage = new Stage(renderer, physics, assets);
    this.site = new BuildingSite(scene, physics, loading, assets, this.stage.ground, time);
    const cannon = new Cannon(scene, this.buildingCenter);
    const wizard = new Wizard(scene, this.buildingCenter, this.site.effects.fire, this.site.lights);
    this.launchers = { cannon, wizard };
    this.powers = { cannon: cannon.power.defaultPower, wizard: wizard.power.defaultPower };
    this.fireballVisual = new FireballVisual();
    scene.add(this.fireballVisual.root);
    this.fireballVisual.root.visible = false;
    this.projectiles = {
      cannon: new Projectile(scene, physics),
      wizard: new Projectile(scene, physics, FIREBALL_SPEC, this.fireballVisual.root),
    };
    this.trajectory = new TrajectoryLine(scene);

    camera.position.set(0, CAMERA.idleHeight, CAMERA.idleRadius);
    camera.lookAt(this.buildingCenter);
    this.rig = new CameraRig(camera);
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbitCam = new SpectateCam(this.orbit);
    this.aimCam = new AimCam(cannon);
    this.killCam = new XRayKillCam(scene, this.rig, time, this.projectiles.cannon, this.postfx);
    this.popups = new MoneyPopups(camera);
    this.ecoHud = new EconomyHud();
    this.economy.onPayout = (x, y, z, amount, rare) => this.popups.add(x, y, z, amount, rare);
    this.hud = new HUD(
      (id) => this.requestLauncher(id),
      () => this.requestIdle(),
      () => this.requestReset(),
    );

    this.bindStates();
    this.bindInput(canvas);
    this.enterIdle();
    this.rebuild();
  }

  get state(): GameState {
    return this.fsm.state;
  }

  /** 지금 고른 발사대 */
  get launcher(): Launcher {
    return this.launchers[this.fsm.launcher];
  }

  /** 지금 고른 발사대의 발사체 */
  get projectile(): Projectile {
    return this.projectiles[this.fsm.launcher];
  }

  private get power(): number {
    return this.powers[this.fsm.launcher];
  }

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.site.step(dt); // 여기서 충돌 이벤트가 처리되며 onCollision이 불린다
    this.projectile.step(dt);
    this.stepPenetration(dt);
    if (!this.fsm.is(GameState.PROJECTILE_CAM)) return;
    const shell = this.projectile.spec.kind === 'shell';
    if (shell && !this.pendingHit && !this.killCam.active) this.watchForKillShot();
    if (this.pendingHit) {
      this.fsm.transition(GameState.IMPACT);
    } else if (
      !this.projectile.active ||
      this.projectile.flightTime > this.projectile.spec.maxFlightSec
    ) {
      // 빗나감: 아무것도 안 맞고 날아가 버렸다
      this.impactPoint.copy(this.projectile.position);
      this.projectile.remove();
      this.releaseFireballLight();
      this.fireSpectate = false;
      this.fsm.transition(GameState.SPECTATE);
    }
  }

  /** 렌더 프레임마다 (실제 경과 시간) */
  update(dt: number): void {
    this.clock += dt;
    switch (this.fsm.state) {
      case GameState.CUTSCENE:
        if (this.cutscene?.done) this.fsm.transition(GameState.AIMING);
        break;
      case GameState.AIMING:
        if (this.chargeLeft >= 0) {
          this.chargeLeft -= dt;
          if (this.chargeLeft < 0) this.fsm.transition(GameState.PROJECTILE_CAM);
        } else {
          this.updateAim(dt);
        }
        break;
      case GameState.IMPACT:
        this.hitStopLeft -= dt;
        // 관통 중이면 다 파고들 때까지, 킬캠이면 킬캠이 끝날 때까지 기다린다
        if (this.hitStopLeft <= 0 && !this.drilling && !this.killCam.active) {
          this.fsm.transition(GameState.SPECTATE);
        }
        break;
    }
    this.killCam.update(dt);
    this.launchers.cannon.update(dt);
    this.launchers.wizard.update(dt);
    this.updateFireball(dt);
    this.site.update(dt);
    this.economy.update(dt * this.time.timeScale); // 파괴율은 물리 시간 기준 갱신 주기
    this.popups.update(dt);
    this.ecoHud.update(dt, this.economy);
    this.economyStats.ms = this.economy.consumeCostMs() + this.popups.lastMs;
    this.stage.update(dt, this.site.bounds);
    this.rig.update(dt);
  }

  /** 디버그 GUI Reset/Regenerate: 건물을 새로 만든다 */
  reset(): void {
    if (this.fsm.is(GameState.SPECTATE)) this.fsm.transition(GameState.IDLE);
    this.rebuild();
  }

  // ── 상태 전이 ───────────────────────────────────────────

  private bindStates(): void {
    const { fsm } = this;
    fsm.onEnter(GameState.IDLE, () => this.enterIdle());
    fsm.onEnter(GameState.CUTSCENE, () => this.enterCutscene());
    fsm.onEnter(GameState.AIMING, () => {
      this.launcher.finishAppear();
      this.chargeLeft = -1;
      this.cutscene = null;
      this.trajectory.visible = true;
      this.rig.setController(this.aimCam);
    });
    fsm.onExit(GameState.AIMING, () => {
      this.trajectory.visible = false;
    });
    fsm.onEnter(GameState.PROJECTILE_CAM, () => this.fire());
    fsm.onEnter(GameState.IMPACT, () => this.enterImpact());
    fsm.onExit(GameState.IMPACT, () => {
      if (this.hitStopApplied) this.time.timeScale = this.savedTimeScale;
      this.hitStopApplied = false;
    });
    fsm.onEnter(GameState.SPECTATE, () => {
      this.killCam.stop(); // 빗나간 경우 등 안전장치
      this.orbit.enabled = true;
      const fire = this.fireSpectate ? this.site.fire : null;
      this.orbitCam.start(this.impactPoint, this.rig.camera.position, {
        radius: CAMERA.spectateRadius,
        height: CAMERA.spectateHeight,
        speed: CAMERA.spectateSpeed,
        // 화재: 불이 번지는 걸 보도록 더 오래, 불 중심을 따라가며 천천히 줌아웃
        autoSec: fire ? CAMERA.spectateAutoSec * 2.5 : CAMERA.spectateAutoSec,
        zoomPerSec: fire ? FIRE.spectateZoomPerSec : 0,
        zoomMax: FIRE.spectateZoomMax,
        follow: fire?.center ?? null,
        followSec: FIRE.spectateFollowSec,
      });
      this.rig.setController(this.orbitCam);
    });
    fsm.onChange((_from, to) => this.hud.setState(to, this.ready));
    this.hud.setState(fsm.state, this.ready);
  }

  private enterIdle(): void {
    this.orbit.enabled = true;
    this.orbitCam.start(this.buildingCenter, this.rig.camera.position, {
      radius: CAMERA.idleRadius,
      height: CAMERA.idleHeight - this.buildingCenter.y,
      speed: CAMERA.idleSpeed,
      autoSec: Infinity,
    });
    this.rig.setController(this.orbitCam);
  }

  private enterCutscene(): void {
    this.orbit.enabled = false;
    const launcher = this.launcher;
    // 발사대는 한 번에 하나만 나와 있다
    if (launcher !== this.launchers.cannon) this.launchers.cannon.hide();
    if (launcher !== this.launchers.wizard) this.launchers.wizard.hide();
    launcher.appear();
    this.aimCam.launcher = launcher;
    const toLauncher = new Vector3(
      launcher.root.position.x - this.buildingCenter.x,
      0,
      launcher.root.position.z - this.buildingCenter.z,
    ).normalize();
    this.cutscene = new CutsceneCam(
      this.rig.camera.position.clone(),
      this.buildingCenter,
      toLauncher,
      this.aimCam.poseFor(this.aimPose),
      launcher.cutscene,
    );
    this.rig.setController(this.cutscene, 0); // 컷신은 지금 위치에서 출발한다
  }

  private fire(): void {
    const launcher = this.launcher;
    this.aimLaunch(launcher);
    this.pendingHit = null;
    this.projectile.launch(this.muzzle, this.launchVelocity);
    launcher.fire();
    this.rig.shake.add(launcher.fireTrauma);
    if (this.projectile.spec.kind === 'fireball') {
      this.postfx.pulse(FIREBALL.postPulse * 0.5); // 발사 섬광
      this.trailAcc = 0;
      this.fireballLight ??= this.site.lights.acquire();
      if (this.fireballLight) {
        this.fireballLight.color.set(FIREBALL.lightColor);
        this.fireballLight.distance = FIREBALL.lightDistance;
      }
    }
    this.chaseCam.start(this.projectile, this.rig.camera.position, launcher.chase);
    this.rig.setController(this.chaseCam, CAMERA.blendSec / 3);
  }

  /** 발사대의 포구(this.muzzle)와 발사 속도(this.launchVelocity)를 채운다. 반환: 속력 */
  private aimLaunch(launcher: Launcher): number {
    const speed = muzzleSpeed(this.power, launcher.power.speedMin, launcher.power.speedMax);
    launcher.muzzleWorld(this.muzzle);
    launcher.aimDirection(this.launchVelocity).multiplyScalar(speed);
    return speed;
  }

  /** 파이어볼 비행 중: 셸 일렁임, 꼬리 불꽃·연기, 따라다니며 깜빡이는 주황 라이트 */
  private updateFireball(dt: number): void {
    const p = this.projectiles.wizard;
    this.fireballVisual.update(this.clock);
    if (!p.active) return;
    const fire = this.site.effects.fire;
    this.trailAcc += dt * this.time.timeScale * FIREBALL.trailFlamesPerSec;
    for (; this.trailAcc >= 1; this.trailAcc--) {
      fire.trail(p.position, FIREBALL.radius * (1.2 + Math.random()));
      if (Math.random() < FIREBALL.trailSmokePerSec / FIREBALL.trailFlamesPerSec) {
        fire.smokePuff(p.position, FIRE.smokeSize * 0.5, 0.5);
      }
    }
    const light = this.fireballLight;
    if (light) {
      light.position.copy(p.position);
      const w = this.clock * FIREBALL.flickerHz * Math.PI * 2;
      light.intensity =
        FIREBALL.lightIntensity * (1 + FIREBALL.flickerAmount * Math.sin(w) * Math.sin(w * 0.37));
    }
  }

  private releaseFireballLight(): void {
    this.site.lights.release(this.fireballLight);
    this.fireballLight = null;
  }

  private enterImpact(): void {
    const hit = this.pendingHit!;
    this.pendingHit = null;
    this.impactPoint.copy(hit.point);
    this.projectile.remove();
    if (this.projectile.spec.kind === 'fireball') {
      this.enterFireImpact(hit);
      return;
    }
    this.fireSpectate = false;
    this.blasts = this.hitBuilding
      ? penetrationBlasts(
          hit.point,
          hit.direction,
          hit.energy,
          hit.speed,
          0,
          this.resistanceAt(hit),
        )
      : [{ point: hit.point, energy: hit.energy, delay: 0 }];
    this.nextBlast = 0;
    this.drillTime = 0;
    this.drillFrom.copy(hit.point);
    this.drillDir.copy(hit.direction);
    this.drillSpeed = hit.speed;
    const last = this.blasts[this.blasts.length - 1]!.point;
    this.drillDepth = this.drillFrom.distanceTo(last);
    // 관통하면 엑스레이 킬캠 (비행 중에 미리 시작했을 수도 있다)
    if (this.blasts.length > 1 && !this.killCam.active) {
      this.killCam.start(this.site, hit.point, hit.direction, this.drillDepth);
    }
    this.stepPenetration(0); // 표면 폭발은 즉시
    if (this.killCam.active) {
      this.hitStopLeft = 0; // 시간은 킬캠이 쥔다 (훨씬 느린 슬로모션)
    } else {
      this.applyHitStop();
    }
    this.rig.shake.add(CAMERA.impactTrauma);
    if (!this.killCam.active) this.postfx.pulse();
  }

  /** 관통 저항: 맞은 곳과 그 안쪽이 이미 부서져 있을수록 작다 (더 깊이 파고든다) */
  private resistanceAt(hit: ProjectileHit): number {
    const d = this.site.destruction;
    if (!d) return 1;
    const r = DAMAGE_VISUAL.penetrationSampleRadius;
    const probe = this.blastPoint.copy(hit.point).addScaledVector(hit.direction, r);
    const damage = (d.damageNear(hit.point, r) + d.damageNear(probe, r)) / 2;
    return 1 - DAMAGE_VISUAL.penetrationDamageFactor * damage;
  }

  /** 파이어볼: 관통·킬캠 없이 화염 폭발 + 화재, 일반 hit-stop */
  private enterFireImpact(hit: ProjectileHit): void {
    this.releaseFireballLight();
    this.fireSpectate = true;
    this.site.fireBlast(this.blastPoint.copy(hit.point));
    this.applyHitStop();
    this.rig.shake.add(FIREBALL.impactTrauma);
    this.postfx.pulse(FIREBALL.postPulse);
  }

  private applyHitStop(): void {
    this.savedTimeScale = this.time.timeScale;
    this.time.timeScale = HIT_STOP.timeScale;
    this.hitStopLeft = HIT_STOP.durationSec;
    this.hitStopApplied = true;
  }

  /**
   * 비행 중: 관통할 만큼 강한데 곧(실제 시간 approachRealSec 안에) 건물에 맞을 것 같으면
   * 맞기 전에 킬캠을 시작해 포탄이 다가가는 모습부터 슬로모션으로 보여준다.
   */
  private watchForKillShot(): void {
    const v = this.projectile.velocity(this.flightVelocity);
    const speed = v.length();
    const depth = penetrationDepth(0.5 * PROJECTILE.mass * speed * speed);
    if (depth <= 0) return;
    const reach = speed * XRAY.approachRealSec * XRAY.timeScale;
    const probe = this.projectile.probe(reach, v);
    if (!probe || !this.site.destruction?.fragments.chunkOfBody(probe.body)) return;
    this.killCam.start(this.site, probe.point, v.divideScalar(speed), depth);
  }

  private onCollision(a: PhysicsBody, b: PhysicsBody): void {
    if (!this.fsm.is(GameState.PROJECTILE_CAM) || this.pendingHit) return;
    const projectile = this.projectile;
    if (!projectile.isBody(a) && !projectile.isBody(b)) return;
    const other = projectile.isBody(a) ? b : a;
    this.hitBuilding = this.site.destruction?.fragments.chunkOfBody(other) !== undefined;
    this.pendingHit = projectile.impact();
  }

  /** 관통 경로의 폭발이 남아 있는지 */
  private get drilling(): boolean {
    return this.nextBlast < this.blasts.length;
  }

  /**
   * 관통 진행 (물리 시간): 때가 된 폭발을 터뜨리고, 포탄 메시를 경로를 따라 움직인다.
   * hit-stop 중엔 물리 시간이 느려서 파고드는 모습이 보인다.
   */
  private stepPenetration(dt: number): void {
    if (!this.drilling) return;
    this.drillTime += dt;
    while (this.drilling && this.blasts[this.nextBlast]!.delay <= this.drillTime) {
      const b = this.blasts[this.nextBlast++]!;
      this.site.detonate(this.blastPoint.set(b.point.x, b.point.y, b.point.z), b.energy);
      if (this.nextBlast > 1) this.impactPoint.copy(this.blastPoint); // 관람 중심은 가장 깊은 폭발
    }
    if (!this.drilling) this.killCam.finishDrilling();
    const mesh = this.projectiles.cannon.mesh;
    mesh.visible = this.drilling;
    if (mesh.visible) {
      const d = Math.min(this.drillTime * this.drillSpeed, this.drillDepth);
      mesh.position.copy(this.drillFrom).addScaledVector(this.drillDir, d);
    }
  }

  private requestLauncher(id: LauncherId): void {
    if (this.ready && this.fsm.is(GameState.IDLE, GameState.SPECTATE)) {
      this.fsm.transition(GameState.CUTSCENE, id);
    }
  }

  /** 관람 → 처음 화면(IDLE). 부서진 건물(과 불)은 그대로 두고 발사대만 숨긴다 */
  private requestIdle(): void {
    if (!this.fsm.is(GameState.SPECTATE)) return;
    this.hideLaunchers();
    this.fsm.transition(GameState.IDLE);
  }

  private requestReset(): void {
    if (!this.fsm.is(GameState.SPECTATE)) return;
    this.fsm.transition(GameState.IDLE);
    this.rebuild();
  }

  private hideLaunchers(): void {
    this.launchers.cannon.hide();
    this.launchers.wizard.hide();
  }

  private skipCutscene(): void {
    this.launcher.finishAppear();
    this.fsm.transition(GameState.AIMING);
  }

  /** 건물 재생성. 끝나면 ready + 충돌 훅 연결 + 카메라 중심 갱신 */
  private rebuild(): void {
    this.ready = false;
    this.hideLaunchers();
    this.hud.setState(this.fsm.state, this.ready);
    this.economy.detach();
    this.popups.clear();
    void this.site.reset().then((ok) => {
      if (!ok) return;
      const { footprint, height } = this.site;
      if (footprint) {
        this.buildingCenter.set(
          (footprint.min.x + footprint.max.x) / 2,
          height * 0.45,
          (footprint.min.z + footprint.max.z) / 2,
        );
      }
      this.site.destruction!.onCollisionStarted = (a, b) => this.onCollision(a, b);
      this.attachEconomy();
      this.ready = true;
      if (this.fsm.is(GameState.IDLE)) this.enterIdle(); // 새 건물 중심으로
      this.hud.setState(this.fsm.state, this.ready);
    });
  }

  /** 새 건물의 장부를 연다. 희귀 파편(켜져 있으면)은 금빛으로 */
  private attachEconomy(): void {
    const d = this.site.destruction!;
    const frags = d.fragments.fragments;
    const ledger = this.economy.attach(
      d,
      {
        count: d.graph.nodeCount,
        mass: d.graph.mass,
        kind: (i) => this.site.kindOf(i),
        material: (i) => (frags[i]!.material === MATERIAL.glass ? 'glass' : 'concrete'),
        durability: (i) => d.durability.max[i]!,
      },
      this.site.settings.seed,
    );
    const gold = ECONOMY.rareColor;
    for (let i = 0; i < ledger.rare.length; i++) {
      if (ledger.rare[i]) d.fragments.meshes.setBaseColor(i, gold.r, gold.g, gold.b);
    }
  }

  // ── 조준 ───────────────────────────────────────────────

  private updateAim(dt: number): void {
    const held = (codes: readonly string[]) => codes.some((c) => this.keys.has(c));
    const launcher = this.launcher;
    let { yaw, pitch } = launcher;
    const turn = CANNON.keySpeed * dt;
    // 발사대 뒤에서 보면 +yaw가 왼쪽
    if (held(AIM_KEYS.left)) yaw += turn;
    if (held(AIM_KEYS.right)) yaw -= turn;
    if (held(AIM_KEYS.up)) pitch += turn;
    if (held(AIM_KEYS.down)) pitch -= turn;
    if (held(AIM_KEYS.powerUp)) this.setPower(this.power + CANNON.keyPowerSpeed * dt);
    if (held(AIM_KEYS.powerDown)) this.setPower(this.power - CANNON.keyPowerSpeed * dt);
    launcher.setAim(yaw, pitch);

    const speed = this.aimLaunch(launcher);
    this.trajectory.update(this.muzzle, this.launchVelocity, launcher.projectile.gravityScale);
    this.hud.setPower(this.power, speed);
  }

  private setPower(p: number): void {
    this.powers[this.fsm.launcher] = Math.min(Math.max(p, 0), 1);
  }

  /** 발사: 충전이 있는 발사대는 chargeSec 뒤에 (그동안 조준 입력 잠금) */
  private pullTrigger(): void {
    const launcher = this.launcher;
    if (launcher.chargeSec <= 0) {
      this.fsm.transition(GameState.PROJECTILE_CAM);
      return;
    }
    this.chargeLeft = launcher.chargeSec;
    this.trajectory.visible = false;
    launcher.beginCharge();
  }

  // ── 입력 ───────────────────────────────────────────────

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p || !this.fsm.is(GameState.AIMING) || this.chargeLeft >= 0) return;
      const s = CANNON.dragSensitivity;
      const l = this.launcher;
      l.setAim(l.yaw - (e.clientX - p.x) * s, l.pitch - (e.clientY - p.y) * s);
      p.x = e.clientX;
      p.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = this.pointer;
      this.pointer = null;
      if (!p || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (moved > SANDBOX.clickDragThresholdPx) return; // 드래그였음
      this.onPrimaryAction();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.fsm.is(GameState.AIMING) || this.chargeLeft >= 0) return;
        e.preventDefault();
        this.setPower(this.power - Math.sign(e.deltaY) * CANNON.wheelPowerStep);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      this.keys.add(e.code);
      if (e.repeat) return; // 꾹 누르고 있어도 스킵 → 발사가 연달아 일어나지 않게
      if (e.code === 'Space') {
        e.preventDefault();
        this.onPrimaryAction();
      } else if (e.code === 'KeyC') {
        this.requestLauncher('cannon');
      } else if (e.code === 'KeyF') {
        this.requestLauncher('wizard');
      } else if (e.code === 'KeyR') {
        this.requestReset();
      } else if (e.code === 'Escape') {
        this.requestIdle();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 클릭 / Space: 컷신 스킵 또는 발사 */
  private onPrimaryAction(): void {
    if (this.killCam.active) this.killCam.skip();
    else if (this.fsm.is(GameState.CUTSCENE)) this.skipCutscene();
    else if (this.fsm.is(GameState.AIMING) && this.chargeLeft < 0) this.pullTrigger();
  }
}

/** 디버그 GUI 입력칸에 타이핑 중이면 게임 단축키를 무시 */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

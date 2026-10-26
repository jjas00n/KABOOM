// 게임: 건물 + 대포 + 포탄 + 카메라를 상태 머신(StateMachine)으로 잇는다.
//   IDLE            건물 전경을 천천히 돈다 (드래그로 둘러보기). [Cannon]
//   CANNON_CUTSCENE 대포가 솟아오르고 카메라가 건물 → 대포 뒤로 날아간다. 클릭/Space 스킵
//   AIMING          드래그/WASD 조준, 휠/QE 파워, 예상 궤적 점선. Space/클릭 발사
//   PROJECTILE_CAM  체이스 캠. 처음 부딪힌 곳에서 IMPACT (아무것도 안 맞으면 SPECTATE)
//   IMPACT          폭발 + hit-stop(시간 느리게) + 카메라 흔들림
//   SPECTATE        충돌 지점 자동 회전 → 자유 관람. [Cannon] 재발사 / [Reset] 건물 재생성
import { Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AimCam } from '../camera/AimCam';
import { CameraRig, type CameraPose } from '../camera/CameraRig';
import { ChaseCam } from '../camera/ChaseCam';
import { CutsceneCam } from '../camera/CutsceneCam';
import { SpectateCam } from '../camera/SpectateCam';
import { CAMERA, CANNON, HIT_STOP, PROJECTILE, SANDBOX } from '../config';
import type { Renderer } from '../core/Renderer';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import { createStage } from '../sandbox/Stage';
import { HUD } from '../ui/HUD';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { muzzleSpeed } from './ballistics';
import { BuildingSite } from './BuildingSite';
import { Cannon } from './Cannon';
import { Projectile, type ProjectileHit } from './Projectile';
import { GameState, StateMachine } from './StateMachine';
import { TrajectoryLine } from './TrajectoryLine';

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
  readonly cannon: Cannon;
  readonly projectile: Projectile;
  /** 파워 0~1 */
  power: number = PROJECTILE.defaultPower;
  /** 건물이 준비됐는지 (생성 중엔 대포 못 씀) */
  ready = false;

  private readonly hud: HUD;
  private readonly orbit: OrbitControls;
  private readonly orbitCam: SpectateCam;
  private readonly aimCam: AimCam;
  private readonly chaseCam = new ChaseCam();
  private cutscene: CutsceneCam | null = null;
  private readonly trajectory: TrajectoryLine;

  private readonly buildingCenter = new Vector3(0, 0, 0);
  private readonly impactPoint = new Vector3();
  private pendingHit: ProjectileHit | null = null;
  private hitStopLeft = 0;
  private savedTimeScale = 1;

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
  ) {
    const { scene, camera, canvas } = renderer;
    createStage(renderer, physics);
    this.site = new BuildingSite(scene, physics, loading);
    this.cannon = new Cannon(scene, this.buildingCenter);
    this.projectile = new Projectile(scene, physics);
    this.trajectory = new TrajectoryLine(scene);

    camera.position.set(0, CAMERA.idleHeight, CAMERA.idleRadius);
    camera.lookAt(this.buildingCenter);
    this.rig = new CameraRig(camera);
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbitCam = new SpectateCam(this.orbit);
    this.aimCam = new AimCam(this.cannon);
    this.hud = new HUD(
      () => this.requestCannon(),
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

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.site.step(dt); // 여기서 충돌 이벤트가 처리되며 onCollision이 불린다
    this.projectile.step(dt);
    if (!this.fsm.is(GameState.PROJECTILE_CAM)) return;
    if (this.pendingHit) {
      this.fsm.transition(GameState.IMPACT);
    } else if (!this.projectile.active || this.projectile.flightTime > PROJECTILE.maxFlightSec) {
      // 빗나감: 아무것도 안 맞고 날아가 버렸다
      this.impactPoint.copy(this.projectile.position);
      this.projectile.remove();
      this.fsm.transition(GameState.SPECTATE);
    }
  }

  /** 렌더 프레임마다 (실제 경과 시간) */
  update(dt: number): void {
    switch (this.fsm.state) {
      case GameState.CANNON_CUTSCENE:
        if (this.cutscene?.done) this.fsm.transition(GameState.AIMING);
        break;
      case GameState.AIMING:
        this.updateAim(dt);
        break;
      case GameState.IMPACT:
        this.hitStopLeft -= dt;
        if (this.hitStopLeft <= 0) this.fsm.transition(GameState.SPECTATE);
        break;
    }
    this.cannon.update(dt);
    this.site.update(dt);
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
    fsm.onEnter(GameState.CANNON_CUTSCENE, () => this.enterCutscene());
    fsm.onEnter(GameState.AIMING, () => {
      this.cannon.finishRise();
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
      this.time.timeScale = this.savedTimeScale;
    });
    fsm.onEnter(GameState.SPECTATE, () => {
      this.orbit.enabled = true;
      this.orbitCam.start(this.impactPoint, this.rig.camera.position, {
        radius: CAMERA.spectateRadius,
        height: CAMERA.spectateHeight,
        speed: CAMERA.spectateSpeed,
        autoSec: CAMERA.spectateAutoSec,
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
    this.cannon.rise();
    const toCannon = new Vector3(
      CANNON.position.x - this.buildingCenter.x,
      0,
      CANNON.position.z - this.buildingCenter.z,
    ).normalize();
    this.cutscene = new CutsceneCam(
      this.rig.camera.position.clone(),
      this.buildingCenter,
      toCannon,
      this.aimCam.poseFor(this.aimPose),
    );
    this.rig.setController(this.cutscene, 0); // 컷신은 지금 위치에서 출발한다
  }

  private fire(): void {
    const speed = muzzleSpeed(this.power, PROJECTILE.muzzleSpeedMin, PROJECTILE.muzzleSpeedMax);
    this.cannon.muzzleWorld(this.muzzle);
    this.cannon.aimDirection(this.launchVelocity).multiplyScalar(speed);
    this.pendingHit = null;
    this.projectile.launch(this.muzzle, this.launchVelocity);
    this.cannon.fire();
    this.rig.shake.add(CAMERA.fireTrauma);
    this.chaseCam.start(this.projectile, this.rig.camera.position);
    this.rig.setController(this.chaseCam, CAMERA.blendSec / 3);
  }

  private enterImpact(): void {
    const hit = this.pendingHit!;
    this.pendingHit = null;
    this.impactPoint.copy(hit.point);
    this.projectile.remove();
    this.site.detonate(hit.point, hit.energy);
    this.savedTimeScale = this.time.timeScale;
    this.time.timeScale = HIT_STOP.timeScale;
    this.hitStopLeft = HIT_STOP.durationSec;
    this.rig.shake.add(CAMERA.impactTrauma);
  }

  private onCollision(a: PhysicsBody, b: PhysicsBody): void {
    if (!this.fsm.is(GameState.PROJECTILE_CAM) || this.pendingHit) return;
    if (this.projectile.isBody(a) || this.projectile.isBody(b)) {
      this.pendingHit = this.projectile.impact();
    }
  }

  private requestCannon(): void {
    if (this.ready && this.fsm.is(GameState.IDLE, GameState.SPECTATE)) {
      this.fsm.transition(GameState.CANNON_CUTSCENE);
    }
  }

  private requestReset(): void {
    if (!this.fsm.is(GameState.SPECTATE)) return;
    this.fsm.transition(GameState.IDLE);
    this.rebuild();
  }

  private skipCutscene(): void {
    this.cannon.finishRise();
    this.fsm.transition(GameState.AIMING);
  }

  /** 건물 재생성. 끝나면 ready + 충돌 훅 연결 + 카메라 중심 갱신 */
  private rebuild(): void {
    this.ready = false;
    this.cannon.lower();
    this.hud.setState(this.fsm.state, this.ready);
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
      this.ready = true;
      if (this.fsm.is(GameState.IDLE)) this.enterIdle(); // 새 건물 중심으로
      this.hud.setState(this.fsm.state, this.ready);
    });
  }

  // ── 조준 ───────────────────────────────────────────────

  private updateAim(dt: number): void {
    const held = (codes: readonly string[]) => codes.some((c) => this.keys.has(c));
    let { yaw, pitch } = this.cannon;
    const turn = CANNON.keySpeed * dt;
    // 대포 뒤에서 보면 +yaw가 왼쪽
    if (held(AIM_KEYS.left)) yaw += turn;
    if (held(AIM_KEYS.right)) yaw -= turn;
    if (held(AIM_KEYS.up)) pitch += turn;
    if (held(AIM_KEYS.down)) pitch -= turn;
    if (held(AIM_KEYS.powerUp)) this.setPower(this.power + CANNON.keyPowerSpeed * dt);
    if (held(AIM_KEYS.powerDown)) this.setPower(this.power - CANNON.keyPowerSpeed * dt);
    this.cannon.setAim(yaw, pitch);

    const speed = muzzleSpeed(this.power, PROJECTILE.muzzleSpeedMin, PROJECTILE.muzzleSpeedMax);
    this.cannon.muzzleWorld(this.muzzle);
    this.cannon.aimDirection(this.launchVelocity).multiplyScalar(speed);
    this.trajectory.update(this.muzzle, this.launchVelocity);
    this.hud.setPower(this.power, speed);
  }

  private setPower(p: number): void {
    this.power = Math.min(Math.max(p, 0), 1);
  }

  // ── 입력 ───────────────────────────────────────────────

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p || !this.fsm.is(GameState.AIMING)) return;
      const s = CANNON.dragSensitivity;
      this.cannon.setAim(
        this.cannon.yaw - (e.clientX - p.x) * s,
        this.cannon.pitch - (e.clientY - p.y) * s,
      );
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
        if (!this.fsm.is(GameState.AIMING)) return;
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
        this.requestCannon();
      } else if (e.code === 'KeyR') {
        this.requestReset();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 클릭 / Space: 컷신 스킵 또는 발사 */
  private onPrimaryAction(): void {
    if (this.fsm.is(GameState.CANNON_CUTSCENE)) this.skipCutscene();
    else if (this.fsm.is(GameState.AIMING)) this.fsm.transition(GameState.PROJECTILE_CAM);
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

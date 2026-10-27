// 파이어볼 마법사 (Launcher 구현): 절차적 메시, 등장 애니메이션, 조준, 충전·발사 연출.
// 오리지널 디자인 — 깊은 남색 로브 + 구리 띠, 넓은 챙의 꺾인 뾰족 모자, 끝에 불씨 구슬이 달린 지팡이.
// 건물 기준 대포 정반대 쪽, 울퉁불퉁한 바위 위에 선다.
//
// 계층: root(바위 위, 건물을 향함) → figure(등장 크기) → body(몸: yaw 일부 + 흔들림), arm
//   arm: yawPivot(오른쪽 어깨, y축) → pitchPivot(x축) → 팔·소매·손·지팡이·구슬(+충전 불덩이)
// 조준 방향·발사 위치는 등장 애니메이션과 무관한 '다 나온 자세' 기준 수식(wizardShot)으로 계산한다.
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type PointLight,
  type Scene,
} from 'three';
import { easeOutBack } from '../camera/easing';
import { FIREBALL, WIZARD } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { createRng } from '../fracture/seeds';
import type { Fire } from '../fx/Fire';
import { FireballVisual } from '../fx/FireballVisual';
import type { LightPool } from '../fx/LightPool';
import { XRAY_HIDE } from '../fx/XRayView';
import { aimDirection, clampAim, muzzleSpeed } from './ballistics';
import type {
  AimCameraSpec,
  AimLimits,
  ChaseSpec,
  CutsceneSpec,
  Launcher,
  PowerRange,
} from './Launcher';
import { FIREBALL_SPEC } from './fireball';

const SEGMENTS = 24;
const ROCK_DETAIL = 3;

export const WIZARD_LIMITS: AimLimits = WIZARD;
export const WIZARD_POWER: PowerRange = {
  speedMin: FIREBALL.speedMin,
  speedMax: FIREBALL.speedMax,
  defaultPower: FIREBALL.defaultPower,
};

/** 어깨에서 구슬 끝(+ 파이어볼 반지름)까지: 파이어볼이 나오는 곳 */
const REACH =
  (WIZARD.armLength - WIZARD.staffGrip + WIZARD.staffLength + WIZARD.orbRadius) * WIZARD.scale +
  FIREBALL.radius;

/** 마법사를 건물 중심 쪽으로 돌리는 기본 방위각 */
export function wizardBaseYaw(buildingCenter: Vec3Like): number {
  return Math.atan2(buildingCenter.x - WIZARD.position.x, buildingCenter.z - WIZARD.position.z);
}

/** 오른쪽 어깨 = 팔 회전축 (월드). 마법사 정면이 +z일 때 오른쪽은 -x */
export function wizardPivot(buildingCenter: Vec3Like, out: Vector3): Vector3 {
  const yaw = wizardBaseYaw(buildingCenter);
  const side = WIZARD.shoulderSide * WIZARD.scale;
  return out.set(
    WIZARD.position.x - Math.cos(yaw) * side,
    WIZARD.rockHeight + WIZARD.shoulderHeight * WIZARD.scale,
    WIZARD.position.z + Math.sin(yaw) * side,
  );
}

/** 파이어볼 발사 상태 (순수 수식): 포구 = 어깨 + 조준 방향 × REACH */
export function wizardShot(
  yaw: number,
  pitch: number,
  power: number,
  buildingCenter: Vec3Like,
): { origin: Vector3; velocity: Vector3 } {
  const a = clampAim(yaw, pitch, WIZARD_LIMITS);
  const dir = new Vector3();
  aimDirection(wizardBaseYaw(buildingCenter), a.yaw, a.pitch, dir);
  const origin = wizardPivot(buildingCenter, new Vector3()).addScaledVector(dir, REACH);
  const speed = muzzleSpeed(power, WIZARD_POWER.speedMin, WIZARD_POWER.speedMax);
  return { origin, velocity: dir.multiplyScalar(speed) };
}

export class Wizard implements Launcher {
  readonly id = 'wizard' as const;
  readonly root = new Group();
  readonly baseYaw: number;
  yaw = 0;
  pitch: number = WIZARD.startPitch;
  readonly limits = WIZARD_LIMITS;
  readonly power = WIZARD_POWER;
  readonly projectile = FIREBALL_SPEC;
  readonly chargeSec = WIZARD.chargeSec;
  readonly fireTrauma = WIZARD.fireTrauma;
  readonly cutscene: CutsceneSpec = {
    durationSec: WIZARD.cutsceneDurationSec,
    overviewRadius: WIZARD.cutsceneOverviewRadius,
    overviewHeight: WIZARD.cutsceneOverviewHeight,
    sideAngle: WIZARD.cutsceneSideAngle,
  };
  readonly aimCamera: AimCameraSpec = {
    back: WIZARD.aimBack,
    up: WIZARD.aimUp,
    ahead: WIZARD.aimAhead,
    side: WIZARD.aimSide,
  };
  readonly chase: ChaseSpec = {
    back: FIREBALL.chaseBack,
    up: FIREBALL.chaseUp,
    lead: FIREBALL.chaseLead,
  };

  private readonly buildingCenter: Vector3;
  private readonly figure = new Group();
  private readonly body = new Group();
  private readonly hat = new Group();
  private readonly yawPivot = new Group();
  private readonly pitchPivot = new Group();
  private readonly orbMaterial: MeshBasicMaterial;
  private readonly orbColor = new Color(WIZARD.orbColor);
  private readonly charge: FireballVisual;
  /** 0 = 안 보임, 1 = 다 나옴 */
  private appearT = 0;
  private appearing = false;
  /** 충전 진행 0~1, 충전 중이 아니면 -1 */
  private chargeT = -1;
  private flashLeft = 0;
  private recoil = 0;
  private light: PointLight | null = null;
  private time = 0;
  private readonly scratch = new Vector3();
  private readonly scratch2 = new Vector3();

  constructor(
    scene: Scene,
    buildingCenter: Vector3,
    private readonly particles: Fire,
    private readonly lights: LightPool,
  ) {
    this.buildingCenter = buildingCenter;
    const { position, rockHeight } = WIZARD;
    this.root.position.set(position.x, rockHeight, position.z);
    this.baseYaw = wizardBaseYaw(buildingCenter);
    this.root.rotation.y = this.baseYaw;
    scene.add(createRock(position.x, position.z));

    const cloth = (color: number) => new MeshStandardMaterial({ color, roughness: 0.85 });
    const robe = cloth(WIZARD.robeColor);
    const trim = new MeshStandardMaterial({
      color: WIZARD.robeTrimColor,
      metalness: 0.8,
      roughness: 0.35,
    });

    // 몸: 로브(아래가 넓은 원뿔대) + 아랫단 구리 띠 + 허리띠 + 머리 + 모자
    const { robeHeight: H, robeBottomRadius: rb, robeTopRadius: rt } = WIZARD;
    const robeMesh = new Mesh(new CylinderGeometry(rt, rb, H, SEGMENTS, 1, true), robe);
    robeMesh.position.y = H / 2;
    const hem = new Mesh(
      new CylinderGeometry(rb * 0.97, rb * 1.01, WIZARD.hemHeight, SEGMENTS, 1, true),
      trim,
    );
    hem.position.y = WIZARD.hemHeight / 2;
    const beltY = H * 0.62;
    const beltR = rt + (rb - rt) * (1 - beltY / H);
    const belt = new Mesh(new CylinderGeometry(beltR * 1.03, beltR * 1.05, 0.06, SEGMENTS), trim);
    belt.position.y = beltY;
    const shoulders = new Mesh(new SphereGeometry(rt * 1.5, SEGMENTS, 12), robe);
    shoulders.scale.set(1.3, 0.6, 1);
    shoulders.position.y = H - 0.05;
    const head = new Mesh(
      new SphereGeometry(WIZARD.headRadius, SEGMENTS, 16),
      new MeshStandardMaterial({ color: WIZARD.skinColor, roughness: 0.7 }),
    );
    head.position.y = H + WIZARD.headRadius * 0.9;
    // 수염 없는 얼굴 대신 깊게 눌러쓴 모자 그림자 — 챙 + 끝이 뒤로 꺾인 원뿔
    const hatMaterial = cloth(WIZARD.hatColor);
    const brim = new Mesh(
      new CylinderGeometry(
        WIZARD.hatBrimRadius,
        WIZARD.hatBrimRadius,
        WIZARD.hatBrimThickness,
        SEGMENTS,
      ),
      hatMaterial,
    );
    const hatBand = new Mesh(
      new CylinderGeometry(
        WIZARD.headRadius * 1.15,
        WIZARD.headRadius * 1.2,
        0.07,
        SEGMENTS,
        1,
        true,
      ),
      trim,
    );
    hatBand.position.y = 0.05;
    const crown = new Mesh(createHatCrownGeometry(), hatMaterial);
    this.hat.add(brim, hatBand, crown);
    this.hat.position.y = H + WIZARD.headRadius * 1.25;
    this.body.add(robeMesh, hem, belt, shoulders, head, this.hat);

    // 왼팔: 몸 옆에 늘어뜨린 소매
    const leftSleeve = new Mesh(
      new ConeGeometry(WIZARD.sleeveRadius, WIZARD.armLength * 1.3, SEGMENTS, 1, true),
      robe,
    );
    leftSleeve.position.set(WIZARD.shoulderSide, H - WIZARD.armLength * 0.6, 0.02);
    leftSleeve.rotation.z = 0.12;
    this.body.add(leftSleeve);

    // 오른팔 + 지팡이: +z를 향해 뻗는다
    this.yawPivot.position.set(-WIZARD.shoulderSide, WIZARD.shoulderHeight, 0);
    this.yawPivot.add(this.pitchPivot);
    const arm = new Mesh(
      // 나팔 소매: 손 쪽이 넓다
      new CylinderGeometry(
        WIZARD.sleeveRadius,
        WIZARD.armRadius,
        WIZARD.armLength,
        SEGMENTS,
        1,
        true,
      ),
      robe,
    );
    arm.rotation.x = Math.PI / 2; // 축 +y → +z (위쪽 반지름이 손 쪽)
    arm.position.z = WIZARD.armLength / 2;
    const cuff = new Mesh(
      new CylinderGeometry(
        WIZARD.sleeveRadius,
        WIZARD.sleeveRadius * 1.05,
        0.05,
        SEGMENTS,
        1,
        true,
      ),
      trim,
    );
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = WIZARD.armLength;
    const hand = new Mesh(
      new SphereGeometry(WIZARD.armRadius * 1.1, 12, 8),
      new MeshStandardMaterial({ color: WIZARD.skinColor, roughness: 0.7 }),
    );
    hand.position.z = WIZARD.armLength;
    const staffStart = WIZARD.armLength - WIZARD.staffGrip;
    const staff = new Mesh(
      new CylinderGeometry(WIZARD.staffRadius, WIZARD.staffRadius * 1.3, WIZARD.staffLength, 10),
      new MeshStandardMaterial({ color: WIZARD.staffColor, roughness: 0.8 }),
    );
    staff.rotation.x = Math.PI / 2;
    staff.position.z = staffStart + WIZARD.staffLength / 2;
    // 지팡이 끝: 구리 갈퀴 3개가 구슬을 감싼다
    const tipZ = staffStart + WIZARD.staffLength;
    const prongs = new Group();
    for (let k = 0; k < 3; k++) {
      const prong = new Mesh(new ConeGeometry(0.018, WIZARD.orbRadius * 2.6, 6), trim);
      const a = (k / 3) * Math.PI * 2;
      prong.position.set(
        Math.cos(a) * WIZARD.orbRadius * 0.8,
        Math.sin(a) * WIZARD.orbRadius * 0.8,
        tipZ + WIZARD.orbRadius * 0.6,
      );
      prong.rotation.x = Math.PI / 2;
      prongs.add(prong);
    }
    this.orbMaterial = new MeshBasicMaterial({ toneMapped: false });
    const orb = new Mesh(new SphereGeometry(WIZARD.orbRadius, 16, 12), this.orbMaterial);
    orb.position.z = tipZ + WIZARD.orbRadius;
    this.charge = new FireballVisual();
    this.charge.root.position.z = tipZ + WIZARD.orbRadius + FIREBALL.radius / WIZARD.scale;
    this.charge.root.visible = false;
    this.pitchPivot.add(arm, cuff, hand, staff, prongs, orb, this.charge.root);

    this.figure.scale.setScalar(WIZARD.scale);
    this.figure.add(this.body, this.yawPivot);
    this.root.add(this.figure);
    for (const m of [robeMesh, hem, belt, shoulders, head, brim, crown, leftSleeve, arm, staff]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }

    this.hide();
    scene.add(this.root);
  }

  get ready(): boolean {
    return this.appearT >= 1;
  }

  hide(): void {
    this.appearT = 0;
    this.appearing = false;
    this.endCharge();
    this.applyPose();
  }

  /** 불씨 소용돌이와 함께 나타나기 시작 (이미 나왔으면 무시) */
  appear(): void {
    if (this.ready || this.appearing) return;
    this.appearing = true;
    const at = this.scratch.copy(this.root.position);
    at.y += WIZARD.shoulderHeight * WIZARD.scale * 0.6;
    for (let i = 0; i < WIZARD.appearEmbers; i++) {
      this.particles.emberToward(
        at,
        1.5 + Math.random() * 1.5,
        WIZARD.appearSec * (0.6 + 0.4 * Math.random()),
      );
    }
  }

  finishAppear(): void {
    this.appearT = 1;
    this.appearing = false;
    this.applyPose();
  }

  setAim(yaw: number, pitch: number): void {
    const a = clampAim(yaw, pitch, this.limits);
    this.yaw = a.yaw;
    this.pitch = a.pitch;
    this.applyPose();
  }

  pivotWorld(out: Vector3): Vector3 {
    return wizardPivot(this.buildingCenter, out);
  }

  aimDirection(out: Vector3): Vector3 {
    aimDirection(this.baseYaw, this.yaw, this.pitch, out);
    return out;
  }

  muzzleWorld(out: Vector3): Vector3 {
    this.pivotWorld(out);
    return out.addScaledVector(this.aimDirection(this.scratch2), REACH);
  }

  /** 충전 시작: 지팡이 끝 불덩이가 커지고, 빛이 오르고, 불씨가 빨려 든다 */
  beginCharge(): void {
    this.chargeT = 0;
    this.charge.root.visible = true;
    this.charge.root.scale.setScalar(0.01);
    this.light ??= this.lights.acquire();
    this.light?.color.set(FIREBALL.lightColor);
    if (this.light) this.light.distance = FIREBALL.lightDistance;
  }

  /** 발사 순간: 충전 불덩이는 사라지고(실제 발사체가 이어받음) 섬광 + 팔 반동 */
  fire(): void {
    this.chargeT = -1;
    this.charge.root.visible = false;
    this.flashLeft = WIZARD.fireFlashSec;
    this.recoil = 1;
    this.light ??= this.lights.acquire();
    const muzzle = this.muzzleWorld(this.scratch);
    this.light?.position.copy(muzzle);
    for (let i = 0; i < 24; i++) this.particles.ember(muzzle, FIREBALL.speedMin * 0.15);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.appearing) {
      this.appearT = Math.min(1, this.appearT + dt / WIZARD.appearSec);
      if (this.appearT >= 1) this.appearing = false;
    }
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt / WIZARD.fireRecoilSec);

    // 구슬은 늘 은은히 깜빡인다
    const flicker = 1 + 0.15 * Math.sin(this.time * WIZARD.orbFlickerHz * Math.PI * 2);
    this.orbMaterial.color
      .copy(this.orbColor)
      .multiplyScalar(WIZARD.orbBrightness * flicker * (this.chargeT >= 0 ? 1.8 : 1));

    const muzzle = this.muzzleWorld(this.scratch);
    if (this.chargeT >= 0) {
      this.chargeT = Math.min(1, this.chargeT + dt / this.chargeSec);
      const s = 0.15 + 0.85 * this.chargeT;
      this.charge.root.scale.setScalar(s / WIZARD.scale);
      this.charge.opacity = this.chargeT;
      this.charge.update(this.time);
      if (this.light) {
        this.light.position.copy(muzzle);
        this.light.intensity = WIZARD.chargeLightIntensity * this.chargeT * flicker;
      }
      if (Math.random() < WIZARD.chargeEmbersPerSec * dt) {
        this.particles.emberToward(muzzle, 1.2 + Math.random(), 0.45);
      }
    } else if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - dt);
      const k = this.flashLeft / WIZARD.fireFlashSec;
      if (this.light) this.light.intensity = WIZARD.fireFlashIntensity * k * k;
      if (this.flashLeft === 0) this.endCharge();
    }
    this.applyPose();
  }

  /** 충전·섬광 라이트를 돌려준다 */
  private endCharge(): void {
    this.chargeT = -1;
    this.flashLeft = 0;
    this.charge.root.visible = false;
    this.lights.release(this.light);
    this.light = null;
  }

  private applyPose(): void {
    const t = this.appearT;
    this.figure.visible = t > 0;
    this.figure.scale.setScalar(WIZARD.scale * Math.max(easeOutBack(t), 0.001));
    const sway = Math.sin(this.time * WIZARD.swayHz * Math.PI * 2);
    this.body.rotation.y = this.yaw * WIZARD.bodyYawFollow;
    this.body.rotation.z = sway * WIZARD.swayAngle;
    this.hat.rotation.z = sway * WIZARD.hatSwayAngle * 0.5;
    this.hat.rotation.x = Math.sin(this.time * WIZARD.swayHz * Math.PI * 1.3) * WIZARD.hatSwayAngle;
    this.yawPivot.rotation.y = this.yaw;
    // 발사 반동: 지팡이 끝이 살짝 들렸다 돌아온다
    this.pitchPivot.rotation.x = -this.pitch - 0.25 * this.recoil * this.recoil;
  }
}

/** 뾰족 모자: 아래가 넓고 끝이 뒤(-z)로 꺾인 원뿔. 바닥이 y = 0 */
function createHatCrownGeometry(): LatheGeometry {
  const { hatHeight: h, headRadius: r, hatBend } = WIZARD;
  const pts: Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new Vector2(r * 1.2 * (1 - t) ** 1.2 + 0.005, t * h));
  }
  const geo = new LatheGeometry(pts, SEGMENTS);
  // 위로 갈수록 뒤로 휘게 (t² 비례)
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setZ(i, pos.getZ(i) - hatBend * t * t);
    pos.setY(i, pos.getY(i) * (1 - 0.15 * t * t));
  }
  geo.computeVertexNormals();
  return geo;
}

/** 꼭대기가 평평한 울퉁불퉁한 바위. 윗면 = rockHeight */
function createRock(x: number, z: number): Mesh {
  const { rockRadius: R, rockHeight: top, rockRoughness } = WIZARD;
  const geo = new IcosahedronGeometry(R, ROCK_DETAIL);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const rng = createRng(WIZARD.rockSeed);
  // 같은 꼭짓점(비인덱스 지오메트리라 여러 번 나온다)은 같은 값으로 밀어야 틈이 안 생긴다
  const bumps = new Map<string, number>();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let bump = bumps.get(key);
    if (bump === undefined) {
      bump = 1 + rockRoughness * (rng() - 0.5);
      bumps.set(key, bump);
    }
    v.multiplyScalar(bump);
    // 아래로 길게 늘여 땅에 묻고, 윗면은 평평하게 깎는다
    v.y = Math.min(v.y * (top / R) * 1.25, top);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const rock = new Mesh(
    geo,
    new MeshStandardMaterial({ color: WIZARD.rockColor, roughness: 0.95, flatShading: true }),
  );
  rock.position.set(x, 0, z);
  rock.castShadow = true;
  rock.receiveShadow = true;
  rock.userData[XRAY_HIDE] = true;
  return rock;
}

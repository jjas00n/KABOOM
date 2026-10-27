// 발사체: CCD 강체. 물리 특성은 ProjectileSpec(질량·반지름·중력 배수), 모양은 visual(Object3D).
// 대포탄: 무겁고 빠르다 (500kg, 40~120m/s). 파이어볼: 가볍고 느리고 거의 직선.
// 얇은 유리·패널을 터널링하지 않게 CCD를 켠다.
// 충돌 판정은 Game이 DestructionSystem.onCollisionStarted로 받아 impact()를 부른다.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import type { ChaseTarget } from '../camera/ChaseCam';
import { CANNON, PROJECTILE, XRAY } from '../config';
import { PROJECTILE_GROUPS } from '../physics/collisionGroups';
import { CANNON_SHELL } from './Cannon';
import type { ProjectileSpec } from './Launcher';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

const SPHERE_SEGMENTS = 24;
/** 엑스레이 중 포탄을 건물 위에 그리는 순서 */
const XRAY_RENDER_ORDER = 3;
const BLACK = new Color(0, 0, 0);

export interface ProjectileHit {
  point: Vector3;
  /** 충돌 직전 진행 방향 (단위 벡터) */
  direction: Vector3;
  /** 충돌 직전 운동에너지 ½mv² (J) */
  energy: number;
  speed: number;
}

/** 앞쪽 레이 검사 결과 */
export interface ProjectileProbe {
  point: Vector3;
  body: PhysicsBody;
  /** 포탄 중심에서 맞을 곳까지 거리 */
  distance: number;
}

export class Projectile implements ChaseTarget {
  /** 물리가 움직이는 렌더 대상 (기본: 대포탄 구) */
  readonly mesh: Object3D;
  /** 킬캠에서 빛나게 할 재질 (기본 대포탄일 때만) */
  private readonly material: MeshStandardMaterial | null = null;
  /** probe용 재사용 객체 (비행 중 매 스텝 부른다) */
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly probeDir = new Vector3();
  /** 발사 후 경과 시간 (물리 시간) */
  flightTime = 0;
  private body: PhysicsBody | null = null;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
    readonly spec: ProjectileSpec = CANNON_SHELL,
    visual: Object3D | null = null,
  ) {
    if (visual) {
      this.mesh = visual;
    } else {
      this.material = new MeshStandardMaterial({
        color: PROJECTILE.color,
        metalness: CANNON.metalness,
        roughness: CANNON.roughness,
      });
      this.mesh = new Mesh(
        new SphereGeometry(spec.radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2),
        this.material,
      );
      this.mesh.castShadow = true;
    }
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** 날고 있는지 (발사됐고 아직 안 맞았고 바디가 살아 있음) */
  get active(): boolean {
    return this.body !== null && this.body.alive;
  }

  /** 렌더 보간된 위치 */
  get position(): Vector3 {
    return this.mesh.position;
  }

  velocity(out: Vector3): Vector3 {
    if (this.body?.alive) {
      const v = this.body.rigidBody.linvel();
      out.set(v.x, v.y, v.z);
    }
    return out;
  }

  isBody(body: PhysicsBody): boolean {
    return body === this.body;
  }

  launch(origin: Vector3, velocity: Vector3): void {
    this.remove();
    const r = this.spec.radius;
    const density = this.spec.mass / ((4 / 3) * Math.PI * r * r * r);
    this.mesh.position.copy(origin);
    this.body = this.physics.add(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setGravityScale(this.spec.gravityScale)
        .setCcdEnabled(true),
      RAPIER.ColliderDesc.ball(r)
        .setDensity(density)
        .setCollisionGroups(PROJECTILE_GROUPS) // 잔해는 뚫고 지나간다
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.mesh,
    );
    this.mesh.visible = true;
    this.flightTime = 0;
  }

  /** 충돌 정보 (충돌 직전 속도 기준). 날고 있지 않으면 null */
  impact(): ProjectileHit | null {
    const body = this.body;
    if (!body?.alive) return null;
    const speed = body.preStepVelocity.length();
    return {
      point: body.currPos.clone(),
      direction: body.preStepVelocity.clone().normalize(),
      energy: 0.5 * body.rigidBody.mass() * speed * speed,
      speed,
    };
  }

  /**
   * 진행 방향으로 maxDistance까지 레이를 쏴 처음 맞을 곳 (자기 자신 제외). 없으면 null.
   * 포탄 반지름만큼 앞당겨 표면에 닿는 지점 기준으로 잰다.
   */
  probe(maxDistance: number, velocity: Vector3): ProjectileProbe | null {
    const body = this.body;
    if (!body?.alive) return null;
    const speed = velocity.length();
    if (speed < 1e-6) return null;
    const dir = this.probeDir.copy(velocity).divideScalar(speed);
    this.ray.origin = body.currPos;
    this.ray.dir = dir;
    const hit = this.physics.world.castRay(
      this.ray,
      maxDistance + this.spec.radius,
      true,
      undefined,
      PROJECTILE_GROUPS, // 포탄이 실제로 부딪히는 것만 (잔해 제외)
      undefined,
      body.rigidBody,
    );
    if (!hit) return null;
    const target = this.physics.getByCollider(hit.collider.handle);
    if (!target) return null;
    return {
      point: body.currPos.clone().addScaledVector(dir, hit.timeOfImpact),
      body: target,
      distance: Math.max(hit.timeOfImpact - this.spec.radius, 0),
    };
  }

  /** 엑스레이 화면: 밝게 빛나고 건물에 가려지지 않게 맨 위에 그린다 */
  setGlow(on: boolean): void {
    if (!this.material) return;
    this.material.emissive.set(on ? XRAY.shellColor : BLACK);
    this.material.depthTest = !on;
    this.mesh.renderOrder = on ? XRAY_RENDER_ORDER : 0;
  }

  step(dt: number): void {
    if (this.active) this.flightTime += dt;
  }

  /** 물리에서 빼고 숨긴다 */
  remove(): void {
    if (this.body) this.physics.remove(this.body);
    this.body = null;
    this.mesh.visible = false;
  }
}

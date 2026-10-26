// 포탄: CCD 강체, 발사/반동
// 무겁고 빠르다 (500kg, 40~120m/s). 얇은 유리·패널을 터널링하지 않게 CCD를 켠다.
// 충돌 판정은 Game이 DestructionSystem.onCollisionStarted로 받아 hit()을 부른다.
import RAPIER from '@dimforge/rapier3d-compat';
import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import type { ChaseTarget } from '../camera/ChaseCam';
import { CANNON, PROJECTILE } from '../config';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

const SPHERE_SEGMENTS = 24;

export interface ProjectileHit {
  point: Vector3;
  /** 충돌 직전 운동에너지 ½mv² (J) */
  energy: number;
  speed: number;
}

export class Projectile implements ChaseTarget {
  readonly mesh: Mesh;
  /** 발사 후 경과 시간 (물리 시간) */
  flightTime = 0;
  private body: PhysicsBody | null = null;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.mesh = new Mesh(
      new SphereGeometry(PROJECTILE.radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2),
      new MeshStandardMaterial({
        color: PROJECTILE.color,
        metalness: CANNON.metalness,
        roughness: CANNON.roughness,
      }),
    );
    this.mesh.castShadow = true;
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
    const r = PROJECTILE.radius;
    const density = PROJECTILE.mass / ((4 / 3) * Math.PI * r * r * r);
    this.mesh.position.copy(origin);
    this.body = this.physics.add(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setCcdEnabled(true),
      RAPIER.ColliderDesc.ball(r)
        .setDensity(density)
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
      energy: 0.5 * body.rigidBody.mass() * speed * speed,
      speed,
    };
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

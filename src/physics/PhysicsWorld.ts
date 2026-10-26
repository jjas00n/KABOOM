// Rapier 월드 래퍼: 초기화, 바디 ↔ 메시 동기화(렌더 보간), 충돌 이벤트 큐
import RAPIER from '@dimforge/rapier3d-compat';
import { InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { PHYSICS } from '../config';
import { CollisionEventQueue } from './CollisionEvents';

/** 물리 바디가 움직일 렌더 대상. InstancedMesh는 인스턴스 한 칸을 가리킨다. */
export type SyncTarget = Object3D | { mesh: InstancedMesh; index: number };

const UNIT_SCALE = new Vector3(1, 1, 1);
const scratchPos = new Vector3();
const scratchQuat = new Quaternion();
const scratchMatrix = new Matrix4();

export class PhysicsBody {
  readonly prevPos = new Vector3();
  readonly currPos = new Vector3();
  readonly prevQuat = new Quaternion();
  readonly currQuat = new Quaternion();
  /** 마지막 스텝에서 깨어 있었는지 */
  awake = true;
  /** 아직 렌더 대상에 반영하지 않은 변화가 있는지 */
  dirty = true;

  constructor(
    readonly rigidBody: RAPIER.RigidBody,
    readonly collider: RAPIER.Collider,
    readonly target: SyncTarget | null,
  ) {
    this.snap();
  }

  /** 순간이동(리셋 등) 후 호출: 보간 없이 현재 위치로 맞춘다 */
  snap(): void {
    this.rigidBody.translation(this.currPos);
    this.rigidBody.rotation(this.currQuat);
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.awake = !this.rigidBody.isSleeping();
    this.dirty = true;
  }
}

export class PhysicsWorld {
  readonly events = new CollisionEventQueue();
  private readonly bodies = new Set<PhysicsBody>();
  private readonly byCollider = new Map<number, PhysicsBody>();
  private readonly touchedMeshes = new Set<InstancedMesh>();
  private readonly onCollision = (h1: number, h2: number, started: boolean): void =>
    this.events.push(h1, h2, started);

  private constructor(
    readonly world: RAPIER.World,
    private readonly eventQueue: RAPIER.EventQueue,
  ) {}

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World(PHYSICS.gravity);
    world.timestep = PHYSICS.fixedTimestep;
    return new PhysicsWorld(world, new RAPIER.EventQueue(true));
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  add(
    bodyDesc: RAPIER.RigidBodyDesc,
    colliderDesc: RAPIER.ColliderDesc,
    target: SyncTarget | null = null,
  ): PhysicsBody {
    const rigidBody = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    const body = new PhysicsBody(rigidBody, collider, target);
    this.bodies.add(body);
    this.byCollider.set(collider.handle, body);
    return body;
  }

  remove(body: PhysicsBody): void {
    if (!this.bodies.delete(body)) return;
    this.byCollider.delete(body.collider.handle);
    this.world.removeRigidBody(body.rigidBody);
  }

  has(body: PhysicsBody): boolean {
    return this.bodies.has(body);
  }

  getByCollider(handle: number): PhysicsBody | undefined {
    return this.byCollider.get(handle);
  }

  /** 고정 timestep 한 번 */
  step(): void {
    this.world.step(this.eventQueue);

    for (const body of this.bodies) {
      const rb = body.rigidBody;
      if (rb.isFixed()) continue;
      const awake = !rb.isSleeping();
      if (awake || body.awake) {
        body.prevPos.copy(body.currPos);
        body.prevQuat.copy(body.currQuat);
        rb.translation(body.currPos);
        rb.rotation(body.currQuat);
        if (!awake) {
          // 막 잠든 바디는 보간 없이 최종 위치에 고정
          body.prevPos.copy(body.currPos);
          body.prevQuat.copy(body.currQuat);
        }
        body.dirty = true;
      }
      body.awake = awake;
    }

    this.eventQueue.drainCollisionEvents(this.onCollision);
  }

  /** 렌더 직전: prev → curr 사이를 alpha로 보간해 렌더 대상에 반영 */
  sync(alpha: number): void {
    for (const body of this.bodies) {
      if (!body.target || (!body.awake && !body.dirty)) continue;
      scratchPos.lerpVectors(body.prevPos, body.currPos, alpha);
      scratchQuat.slerpQuaternions(body.prevQuat, body.currQuat, alpha);

      const target = body.target;
      if (target instanceof Object3D) {
        target.position.copy(scratchPos);
        target.quaternion.copy(scratchQuat);
      } else {
        scratchMatrix.compose(scratchPos, scratchQuat, UNIT_SCALE);
        target.mesh.setMatrixAt(target.index, scratchMatrix);
        this.touchedMeshes.add(target.mesh);
      }
      body.dirty = false;
    }

    for (const mesh of this.touchedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.touchedMeshes.clear();
  }

  /** y가 minY 아래로 떨어진 동적 바디를 제거하고 콜백으로 알린다 */
  removeBelow(minY: number, onRemove?: (body: PhysicsBody) => void): void {
    for (const body of this.bodies) {
      if (body.awake && body.currPos.y < minY) {
        onRemove?.(body);
        this.remove(body);
      }
    }
  }
}

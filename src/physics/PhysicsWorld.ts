// Rapier 월드 래퍼: 초기화, 바디 ↔ 메시 동기화(렌더 보간), 충돌 이벤트 큐
import RAPIER from '@dimforge/rapier3d-compat';
import { BatchedMesh, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { PHYSICS } from '../config';
import { CollisionEventQueue } from './CollisionEvents';

/** BatchedMesh의 인스턴스 하나 */
export interface BatchSlot {
  batch: BatchedMesh;
  id: number;
}

/**
 * 물리 바디가 움직일 렌더 대상. InstancedMesh는 인스턴스 한 칸을 가리킨다.
 * BatchSlot 배열은 재질별로 나뉜 여러 BatchedMesh의 인스턴스를 함께 움직인다(외면 + 단면 등).
 */
export type SyncTarget = Object3D | { mesh: InstancedMesh; index: number } | readonly BatchSlot[];

const UNIT_SCALE = new Vector3(1, 1, 1);
const scratchPos = new Vector3();
const scratchQuat = new Quaternion();
const scratchMatrix = new Matrix4();

export function isBatchSlots(target: SyncTarget): target is readonly BatchSlot[] {
  return Array.isArray(target);
}

export class PhysicsBody {
  readonly prevPos = new Vector3();
  readonly currPos = new Vector3();
  readonly prevQuat = new Quaternion();
  readonly currQuat = new Quaternion();
  /** 마지막 스텝에서 깨어 있었는지 */
  awake = true;
  /** 아직 렌더 대상에 반영하지 않은 변화가 있는지 */
  dirty = true;
  /** PhysicsWorld.remove 후 false. 제거된 바디의 rigidBody 핸들은 건드리면 안 된다. */
  alive = true;

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

export interface BodyStats {
  fixed: number;
  dynamic: number;
  awake: number;
  sleeping: number;
  contactPairs: number;
}

export class PhysicsWorld {
  readonly events = new CollisionEventQueue();
  private readonly bodies = new Set<PhysicsBody>();
  /** fixed가 아닌 바디. step/sync/removeBelow는 이것만 돈다 (fixed 수천 개를 매 스텝 훑지 않게). */
  private readonly moving = new Set<PhysicsBody>();
  /** 방금 fixed로 굳어 마지막 위치를 한 번 더 렌더에 반영해야 하는 바디 */
  private readonly settled = new Set<PhysicsBody>();
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
    world.numSolverIterations = PHYSICS.solverIterations;
    return new PhysicsWorld(world, new RAPIER.EventQueue(true));
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  /**
   * 디버그 통계: 바디 상태별 개수와 깨어 있는 dynamic 바디가 낀 접촉 쌍(narrow-phase) 수.
   * WASM 호출이 많으니 매 프레임이 아니라 샘플링 주기에만 부른다.
   */
  collectStats(out: BodyStats): BodyStats {
    out.fixed = 0;
    out.dynamic = 0;
    out.awake = 0;
    out.sleeping = 0;
    out.contactPairs = 0;
    out.fixed = this.bodies.size - this.moving.size;
    for (const body of this.moving) {
      const rb = body.rigidBody;
      out.dynamic++;
      if (rb.isSleeping()) {
        out.sleeping++;
        continue;
      }
      out.awake++;
      // narrow-phase 쌍(AABB 겹침) 중 실제 접촉점이 있는 것만.
      // 깨어 있는 쌍은 양쪽에서 한 번씩 보이므로 핸들이 큰 쪽에서만 센다
      const own = body.collider;
      this.world.contactPairsWith(own, (other) => {
        const otherBody = this.byCollider.get(other.handle);
        const otherAwake =
          otherBody !== undefined &&
          !otherBody.rigidBody.isFixed() &&
          !otherBody.rigidBody.isSleeping();
        if (otherAwake && other.handle > own.handle) return;
        let touching = false;
        this.world.contactPair(own, other, (manifold) => {
          if (manifold.numContacts() > 0) touching = true;
        });
        if (touching) out.contactPairs++;
      });
    }
    return out;
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
    if (!rigidBody.isFixed()) this.moving.add(body);
    this.byCollider.set(collider.handle, body);
    return body;
  }

  remove(body: PhysicsBody): void {
    if (!this.bodies.delete(body)) return;
    body.alive = false;
    this.moving.delete(body);
    this.settled.delete(body);
    this.byCollider.delete(body.collider.handle);
    this.world.removeRigidBody(body.rigidBody);
  }

  /** fixed → dynamic. 바디 타입은 반드시 이 메서드들로 바꾼다 (moving 집합 유지). */
  setDynamic(body: PhysicsBody): void {
    if (!this.bodies.has(body) || this.moving.has(body)) return;
    body.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.awake = true;
    this.moving.add(body);
    this.settled.delete(body);
  }

  /** 움직이던 바디를 현재 자세 그대로 fixed로 굳힌다 (시뮬레이션 비용 0) */
  setFixed(body: PhysicsBody): void {
    if (!this.moving.delete(body)) return;
    body.rigidBody.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    body.snap();
    body.awake = false;
    this.settled.add(body);
  }

  get movingCount(): number {
    return this.moving.size;
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

    for (const body of this.moving) {
      const rb = body.rigidBody;
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
    for (const body of this.moving) {
      if (body.awake || body.dirty) this.syncBody(body, alpha);
    }
    for (const body of this.settled) this.syncBody(body, 1);
    this.settled.clear();

    for (const mesh of this.touchedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.touchedMeshes.clear();
  }

  private syncBody(body: PhysicsBody, alpha: number): void {
    const target = body.target;
    body.dirty = false;
    if (!target) return;
    scratchPos.lerpVectors(body.prevPos, body.currPos, alpha);
    scratchQuat.slerpQuaternions(body.prevQuat, body.currQuat, alpha);
    if (target instanceof Object3D) {
      target.position.copy(scratchPos);
      target.quaternion.copy(scratchQuat);
      return;
    }
    scratchMatrix.compose(scratchPos, scratchQuat, UNIT_SCALE);
    if (isBatchSlots(target)) {
      for (const slot of target) slot.batch.setMatrixAt(slot.id, scratchMatrix);
    } else {
      target.mesh.setMatrixAt(target.index, scratchMatrix);
      this.touchedMeshes.add(target.mesh);
    }
  }

  /** y가 minY 아래로 떨어진 동적 바디를 제거하고 콜백으로 알린다 */
  removeBelow(minY: number, onRemove?: (body: PhysicsBody) => void): void {
    for (const body of this.moving) {
      if (body.awake && body.currPos.y < minY) {
        onRemove?.(body);
        this.remove(body);
      }
    }
  }
}

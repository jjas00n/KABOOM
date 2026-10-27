// 손상 외관 적용: DamageModel의 damage·자세를 실제 조각에 반영한다.
//   - 서 있는 조각: 손상 자세(틈·처짐·기울어짐)로 fixed 바디를 순간이동 → 콜라이더와 렌더가 같이 움직인다
//   - 모든 조각: 손상 텍스처(damage·매달림·위상) → 셰이더가 균열·열화·흔들림을 그린다
// 바뀐 조각만 대기열에 넣고 프레임당 maxTeleportsPerFrame개까지 처리한다. 텍스처는 프레임당 한 번 올린다.
import { Quaternion, Vector3 } from 'three';
import { DAMAGE_VISUAL } from '../config';
import type { FragmentMaterials } from '../fracture/FragmentMeshes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { DestructionSystem } from './DestructionSystem';

/** 떨어져 나간 조각에 쓰는 damage 상한 (날아가는 조각이 새까맣지 않게) */
const DETACHED_DAMAGE = 0.6;

const offset = new Vector3();
const quat = new Quaternion();
const pos = new Vector3();

export class DamageView {
  /** 원래 자리 대비 지금 적용된 이동 (서 있는 조각, xyz) */
  readonly offsets: Float32Array;
  readonly stats = { teleports: 0, uploads: 0, pending: 0 };
  /** 손상이 바뀔 때마다 1씩 (철근 재배치 판단) */
  revision = 0;
  private enabled: boolean = DAMAGE_VISUAL.enabled;
  private readonly queue: number[] = [];
  private readonly queued: Uint8Array;
  private readonly phase: Float32Array;

  constructor(
    private readonly system: DestructionSystem,
    private readonly physics: PhysicsWorld,
    private readonly materials: FragmentMaterials,
  ) {
    const n = system.graph.nodeCount;
    this.offsets = new Float32Array(n * 3);
    this.queued = new Uint8Array(n);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.phase[i] = (i * 0.618034) % 1; // 황금비로 고르게 흩뜨림
    system.onDamageChanged = (nodes) => {
      for (const i of nodes) this.enqueue(i);
      this.revision++;
    };
    materials.damageOn.value = this.enabled ? 1 : 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 외관 효과 켜고 끄기 (전후 비교). 끄면 서 있는 조각을 원래 자리로 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.materials.damageOn.value = on ? 1 : 0;
    for (let i = 0; i < this.system.graph.nodeCount; i++) this.enqueue(i);
    this.revision++;
  }

  /** 렌더 프레임마다 */
  update(): void {
    const { graph, damage, fragments } = this.system;
    let moved = 0;
    while (this.queue.length > 0 && moved < DAMAGE_VISUAL.maxTeleportsPerFrame) {
      const i = this.queue.shift()!;
      this.queued[i] = 0;
      const attached = graph.attached[i] === 1;
      const d = damage.damage[i]!;
      fragments.meshes.setDamage(
        i,
        attached ? d : Math.min(d, DETACHED_DAMAGE),
        attached ? damage.hanging[i]! : 0,
        this.phase[i]!,
      );
      if (!attached) continue; // 떨어진 조각은 물리가 자리를 정한다
      const chunk = fragments.chunkOf[i];
      if (!chunk || chunk.frags.length !== 1 || !chunk.body.rigidBody.isFixed()) continue;
      if (this.enabled) damage.pose(i, graph.cladding[i] === 1, offset, quat);
      else {
        offset.set(0, 0, 0);
        quat.identity();
      }
      const o = this.offsets;
      if (
        Math.abs(o[i * 3]! - offset.x) < 1e-4 &&
        Math.abs(o[i * 3 + 1]! - offset.y) < 1e-4 &&
        Math.abs(o[i * 3 + 2]! - offset.z) < 1e-4 &&
        chunk.body.currQuat.angleTo(quat) < 1e-4
      ) {
        continue;
      }
      o[i * 3] = offset.x;
      o[i * 3 + 1] = offset.y;
      o[i * 3 + 2] = offset.z;
      const c = fragments.fragments[i]!.centroid;
      this.physics.teleport(chunk.body, pos.set(c.x, c.y, c.z).add(offset), quat);
      moved++;
    }
    this.stats.teleports = moved;
    this.stats.uploads = fragments.meshes.flushDamage();
    this.stats.pending = this.queue.length;
  }

  private enqueue(i: number): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue.push(i);
  }
}

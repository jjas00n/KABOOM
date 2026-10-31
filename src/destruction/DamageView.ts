// 손상 외관 적용: DamageModel의 damage·자세를 실제 조각에 반영한다.
//   - 서 있는 조각: 손상 자세(틈·처짐·기울어짐)로 fixed 바디를 순간이동 → 콜라이더와 렌더가 같이 움직인다
//   - 모든 조각: 손상 텍스처(damage·매달림·위상·피격 시각) → 셰이더가 균열·열화·흔들림·번쩍임을 그린다
//   - 내구도: 깎인 비율만큼 균열(R = max(damage, 손실 × crackAtZero))과 살짝 밀림·회전 (콜라이더도 같이)
// 바뀐 조각만 대기열에 넣고 프레임당 maxTeleportsPerFrame개까지 처리한다. 텍스처는 프레임당 한 번 올린다.
import { Quaternion, Vector3 } from 'three';
import { DAMAGE_VISUAL, DURABILITY } from '../config';
import type { FragmentMaterials } from '../fracture/FragmentMeshes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { DestructionSystem } from './DestructionSystem';

/** 떨어져 나간 조각에 쓰는 damage 상한 (날아가는 조각이 새까맣지 않게) */
const DETACHED_DAMAGE = 0.6;

const offset = new Vector3();
const quat = new Quaternion();
const pos = new Vector3();
const nudgeAxis = new Vector3();
const nudgeQuat = new Quaternion();

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
  /** 마지막 피격 시각 (fireTime 시계, 0 = 없음) */
  private readonly hitTime: Float32Array;

  constructor(
    private readonly system: DestructionSystem,
    private readonly physics: PhysicsWorld,
    private readonly materials: FragmentMaterials,
  ) {
    const n = system.graph.nodeCount;
    this.offsets = new Float32Array(n * 3);
    this.queued = new Uint8Array(n);
    this.phase = new Float32Array(n);
    this.hitTime = new Float32Array(n);
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

  /** 내구도로 버틴 타격: 번쩍임 시각을 기록하고 균열·밀림을 다시 반영 */
  onHit(i: number): void {
    this.hitTime[i] = Math.max(this.materials.fireTime.value, 1e-3);
    this.enqueue(i);
    this.revision++;
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
    const { graph, damage, fragments, durability } = this.system;
    let moved = 0;
    while (this.queue.length > 0 && moved < DAMAGE_VISUAL.maxTeleportsPerFrame) {
      const i = this.queue.shift()!;
      this.queued[i] = 0;
      const attached = graph.attached[i] === 1;
      const loss = durability.lossFraction(i);
      // 구조 손상과 내구도 손실 중 큰 쪽: 마지막까지 깎이면 crackAtZero (눈에 띄게 금 간 모습)
      const d = Math.max(damage.damage[i]!, loss * DURABILITY.crackAtZero);
      fragments.meshes.setDamage(
        i,
        attached ? d : Math.min(d, DETACHED_DAMAGE),
        attached ? damage.hanging[i]! : 0,
        this.phase[i]!,
        this.hitTime[i]!,
      );
      if (!attached) continue; // 떨어진 조각은 물리가 자리를 정한다
      const chunk = fragments.chunkOf[i];
      if (!chunk || chunk.frags.length !== 1 || !chunk.body.rigidBody.isFixed()) continue;
      if (this.enabled) {
        damage.pose(i, graph.cladding[i] === 1, offset, quat);
        if (loss > 0) this.nudge(i, loss);
      } else {
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

  /** 내구도가 깎인 만큼 조각별 고정 방향으로 살짝 밀고 돌린다 (offset·quat에 더함) */
  private nudge(i: number, loss: number): void {
    const h = (k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    };
    offset.x += h(1) * 2 * DURABILITY.nudgeMax * loss;
    offset.y -= Math.abs(h(2)) * DURABILITY.nudgeMax * loss; // 위로는 안 뜬다
    offset.z += h(3) * 2 * DURABILITY.nudgeMax * loss;
    nudgeAxis.set(h(4), h(5), h(6)).normalize();
    quat.multiply(nudgeQuat.setFromAxisAngle(nudgeAxis, DURABILITY.nudgeAngle * loss));
  }

  private enqueue(i: number): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue.push(i);
  }
}

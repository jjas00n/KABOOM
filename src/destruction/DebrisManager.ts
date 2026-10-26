// 동적 조각 상한, 정지 조각 굳히기(sleep→fixed), 수명/페이드아웃 정리 (페이드아웃은 Phase 4)
// dynamic이 된 조각을 등록받아 (감쇠 부여) 매 물리 스텝:
//   1) 임계 속도 아래로 settleAfterSec 머물면 fixed로 굳힘
//   2) Rapier가 스스로 재운 조각도 freezeAfterSec 뒤 fixed로 굳힘
//   굳은 조각은 시뮬레이션 비용 0이고, 다시 맞으면 FragmentSet.activate로 깨어난다.
// 그리고 등록 직후 maxDynamicFragments를 넘으면 작은(같으면 오래된) 조각부터 제거한다.
import { Vector3 } from 'three';
import { DEBRIS } from '../config';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

export interface DebrisPolicy {
  maxDynamicFragments: number;
  settleLinearSpeed: number;
  settleAngularSpeed: number;
  settleAfterSec: number;
  freezeAfterSec: number;
  linearDamping: number;
  angularDamping: number;
}

interface Entry {
  body: PhysicsBody;
  volume: number;
  /** 등록 후 경과 시간 (s, 물리 시간) */
  age: number;
  /** 임계 속도 아래로 머문 시간 */
  still: number;
  /** 잠든 상태로 머문 시간 */
  asleep: number;
}

const velocity = new Vector3();

export class DebrisManager {
  /** 매 스텝 순회는 배열로 (이터레이터 할당 없음), 조회는 Map으로. 제거는 swap-remove. */
  private readonly list: Entry[] = [];
  private readonly entries = new Map<PhysicsBody, Entry>();

  constructor(
    private readonly physics: PhysicsWorld,
    /** 상한 초과로 제거되는 조각의 렌더를 숨기는 콜백 */
    private readonly onRemove: (body: PhysicsBody) => void,
    private readonly policy: DebrisPolicy = DEBRIS,
  ) {}

  get count(): number {
    return this.list.length;
  }

  /** 방금 dynamic이 된 조각 등록 */
  add(body: PhysicsBody, volume: number): void {
    body.rigidBody.setLinearDamping(this.policy.linearDamping);
    body.rigidBody.setAngularDamping(this.policy.angularDamping);
    const entry = this.entries.get(body);
    if (entry) {
      entry.still = 0;
      entry.asleep = 0;
      return;
    }
    const created = { body, volume, age: 0, still: 0, asleep: 0 };
    this.entries.set(body, created);
    this.list.push(created);
  }

  /** 고정 timestep마다 호출 */
  step(dt: number): void {
    const { settleLinearSpeed, settleAngularSpeed, settleAfterSec, freezeAfterSec } = this.policy;
    const lin2 = settleLinearSpeed * settleLinearSpeed;
    const ang2 = settleAngularSpeed * settleAngularSpeed;
    // 뒤에서부터 돌아야 swap-remove 해도 아직 안 본 항목을 건너뛰지 않는다
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entry = this.list[i]!;
      const { body } = entry;
      if (!body.alive) {
        this.removeAt(i); // 다른 경로(킬 높이 등)로 이미 제거됨
        continue;
      }
      entry.age += dt;
      const rb = body.rigidBody;
      if (rb.isSleeping()) {
        entry.asleep += dt;
        if (entry.asleep >= freezeAfterSec) this.freezeAt(i);
        continue;
      }
      entry.asleep = 0;
      rb.linvel(velocity);
      const slowLinear = velocity.lengthSq() < lin2;
      rb.angvel(velocity);
      const slow = slowLinear && velocity.lengthSq() < ang2;
      entry.still = slow ? entry.still + dt : 0;
      if (entry.still >= settleAfterSec) this.freezeAt(i);
    }
  }

  /** 상한을 넘으면 작은 조각부터(부피가 같으면 오래된 것부터) 제거. 반환: 제거 수 */
  enforceCap(): number {
    const over = this.list.length - this.policy.maxDynamicFragments;
    if (over <= 0) return 0;
    const victims = new Set(
      [...this.list].sort((a, b) => a.volume - b.volume || b.age - a.age).slice(0, over),
    );
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entry = this.list[i]!;
      if (!victims.has(entry)) continue;
      this.onRemove(entry.body);
      this.physics.remove(entry.body);
      this.removeAt(i);
    }
    return over;
  }

  clear(): void {
    this.entries.clear();
    this.list.length = 0;
  }

  private freezeAt(i: number): void {
    this.physics.setFixed(this.list[i]!.body);
    this.removeAt(i);
  }

  private removeAt(i: number): void {
    const entry = this.list[i]!;
    this.entries.delete(entry.body);
    this.list[i] = this.list[this.list.length - 1]!;
    this.list.pop();
  }
}

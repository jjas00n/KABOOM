// 완파 판정 (순수 로직): 파괴율이 임계값에 처음 닿는 순간 한 번만 신호를 낸다.
//   - 건물마다 arm()으로 다시 무장. 신호를 낸 뒤에는 파괴율이 어떻게 변해도 다시 내지 않는다
//   - 받는 쪽이 지금 피날레를 시작할 수 없으면(발사체 비행 중 등) pending으로 남았다가 consume으로 꺼낸다
import { FINALE } from '../config';

export class Completion {
  private armed = false;
  private pending = false;

  constructor(readonly threshold: number = FINALE.threshold) {}

  /** 새 건물: 다시 1회 발동 가능 */
  arm(): void {
    this.armed = true;
    this.pending = false;
  }

  /** 파괴율 갱신마다. 처음 임계값에 닿으면 pending */
  update(rate: number): void {
    if (this.armed && rate >= this.threshold) {
      this.armed = false;
      this.pending = true;
    }
  }

  /** 디버그: 임계값과 무관하게 지금 발동 (아직 안 했으면) */
  force(): void {
    if (!this.armed) return;
    this.armed = false;
    this.pending = true;
  }

  /** 발동할 차례인지 (꺼내지는 않는다) */
  get ready(): boolean {
    return this.pending;
  }

  /** 발동 신호를 꺼낸다: 정확히 한 번만 true */
  consume(): boolean {
    const p = this.pending;
    this.pending = false;
    return p;
  }
}

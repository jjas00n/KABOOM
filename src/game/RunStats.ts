// 건물 한 채의 플레이 통계 (순수 로직, 결과 화면용): 발사 수(발사대별), 소요 시간, 최대 연쇄 붕괴.
// 최대 연쇄 붕괴 = 발사 한 번 뒤 다음 발사(또는 피날레) 전까지 분리된 조각 수의 최댓값.
import type { LauncherId } from './Launcher';

export class RunStats {
  readonly shots: Record<LauncherId, number> = { cannon: 0, wizard: 0 };
  /** 건물 준비 이후 경과 실제 시간 (s) */
  elapsed = 0;
  maxChain = 0;
  private current = 0;
  private running = false;

  /** 새 건물 준비 완료: 처음부터 */
  start(): void {
    this.shots.cannon = 0;
    this.shots.wizard = 0;
    this.elapsed = 0;
    this.maxChain = 0;
    this.current = 0;
    this.running = true;
  }

  /** 발사: 이전 발사의 연쇄를 마감하고 새로 센다 */
  fired(id: LauncherId): void {
    this.closeChain();
    this.shots[id]++;
  }

  /** 조각 분리 (파편 수익 지급) count개 — 피날레 분리는 넣지 않는다 */
  released(count: number): void {
    if (this.shots.cannon + this.shots.wizard > 0) this.current += count;
  }

  /** 피날레 시작: 시간을 멈추고 마지막 연쇄를 마감 */
  finish(): void {
    this.closeChain();
    this.running = false;
  }

  /** 실제 시간 dt */
  update(dt: number): void {
    if (this.running) this.elapsed += dt;
  }

  get totalShots(): number {
    return this.shots.cannon + this.shots.wizard;
  }

  private closeChain(): void {
    this.maxChain = Math.max(this.maxChain, this.current);
    this.current = 0;
  }
}

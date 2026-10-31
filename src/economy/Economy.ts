// 경제 지휘자: 지갑 + 배율 + 지금 건물의 장부. 파괴 시스템의 '조각 분리' 이벤트만 구독한다.
//   - 파편 수익: 조각이 dynamic으로 전환되는 순간 (onReleased) 1회 지급
//   - 피날레(7-2): releaseFinale로 따로 들어온다 (출처가 'finale'로 분리된다)
//   - 파괴율: CollapseSolver 갱신 주기(solveIntervalSec)마다만 갱신 (매 프레임 X)
// 물리·렌더를 import하지 않는다. 팝업 등 연출은 onPayout을 구독한다.
import { ECONOMY, STRUCTURE } from '../config';
import { BuildingLedger, type LedgerNodes, type Payout } from './BuildingLedger';
import { Modifiers } from './Modifiers';
import { Wallet, type IncomeSource } from './Wallet';

/** 조각 분리 이벤트를 내는 쪽 (DestructionSystem이 이 모양을 만족한다) */
export interface ReleaseSource {
  /** 조각 원래 질량중심 xyz (팝업 위치) */
  readonly positions: ArrayLike<number>;
  onReleased: ((frags: readonly number[]) => void) | null;
}

export type PayoutListener = (
  x: number,
  y: number,
  z: number,
  amount: number,
  rare: boolean,
  source: IncomeSource,
) => void;

export class Economy {
  readonly wallet = new Wallet();
  readonly modifiers = new Modifiers().set('order', ECONOMY.orderMultiplier);
  /** 지금 건물의 장부 (건물 생성 전 null) */
  ledger: BuildingLedger | null = null;
  /** 파괴율 0~1 (갱신 주기마다) */
  destructionRate = 0;
  /** 지급된 조각마다 (위치, 금액) — 팝업이 묶어서 보여준다 */
  onPayout: PayoutListener | null = null;
  /** 희귀 파편 사용 여부 (다음 건물부터) */
  rareEnabled: boolean = ECONOMY.rareEnabled;

  private source: ReleaseSource | null = null;
  private acc = 0;
  /** 성능 측정: 지난 consumeCostMs 이후 지급 처리에 쓴 시간 (ms) */
  private costMs = 0;

  /** 새 건물: 장부를 만들고 분리 이벤트를 구독한다. 이번 건물 수익은 0부터 */
  attach(source: ReleaseSource, nodes: LedgerNodes, seed: number): BuildingLedger {
    this.detach();
    this.source = source;
    this.ledger = new BuildingLedger(nodes, seed, this.rareEnabled);
    this.wallet.startBuilding();
    this.destructionRate = 0;
    this.acc = 0;
    source.onReleased = (frags) => this.release(frags, 'fragments');
    return this.ledger;
  }

  /** 건물을 버린다 (구독 해제) */
  detach(): void {
    if (this.source) this.source.onReleased = null;
    this.source = null;
    this.ledger = null;
  }

  /** 조각 분리 → 지급. source로 파편/피날레를 구분한다 */
  release(frags: readonly number[], source: IncomeSource = 'fragments'): Payout | null {
    const ledger = this.ledger;
    if (!ledger) return null;
    const started = performance.now();
    const p = this.source?.positions;
    const listener = this.onPayout;
    const payout = ledger.release(
      frags,
      this.modifiers.total,
      listener && p
        ? (i, amount) =>
            listener(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, amount, ledger.rare[i] === 1, source)
        : undefined,
    );
    this.wallet.add(payout.amount, source);
    this.costMs += performance.now() - started;
    return payout;
  }

  /** 지난번 이후 지급 처리에 쓴 시간 (ms)을 돌려주고 0으로 */
  consumeCostMs(): number {
    const ms = this.costMs;
    this.costMs = 0;
    return ms;
  }

  /** 7-2 피날레: 남은 조각을 피날레 수익으로 한 번에 정산 */
  releaseFinale(frags: readonly number[]): Payout | null {
    return this.release(frags, 'finale');
  }

  /** 물리 시간 dt만큼. 파괴율은 CollapseSolver 갱신 주기에 맞춰서만 다시 읽는다 */
  update(dt: number): void {
    this.acc += dt;
    if (this.acc < STRUCTURE.solveIntervalSec) return;
    this.acc = 0;
    this.destructionRate = this.ledger?.destructionRate ?? 0;
  }
}

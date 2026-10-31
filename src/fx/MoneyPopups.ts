// 화면에 떠오르는 +$ 숫자. 조각마다 띄우지 않고, 화면 공간 셀(popupCellPx)마다 popupBinSec 동안 모아
// 합계 하나로 띄운다. DOM 요소 popupMax개를 풀로 돌려 쓴다 (넘치면 가장 오래된 것을 다시 쓴다).
// 큰 금액은 크게·금색으로, 희귀 파편이 섞이면 반짝이게. 시간은 실제 시간 (슬로모션에서도 읽히게).
// 큰 붕괴에선 한 프레임에 조각 수천 개가 지급되므로, add는 월드 격자(popupWorldCellM)에 더하기만 하고
// 화면 투영은 update에서 격자 칸마다 한 번만 한다.
import { Vector3, type PerspectiveCamera } from 'three';
import { ECONOMY } from '../config';
import { formatMoney } from '../ui/format';

interface Bin {
  key: number;
  age: number;
  amount: number;
  /** 금액 가중 화면 좌표 합 */
  sx: number;
  sy: number;
  rare: boolean;
}

interface Popup {
  el: HTMLDivElement;
  age: number;
  x: number;
  y: number;
  scale: number;
}

/** 이번 프레임 지급을 모으는 월드 격자 칸 */
interface WorldCell {
  key: number;
  amount: number;
  /** 금액 가중 월드 좌표 합 */
  wx: number;
  wy: number;
  wz: number;
  rare: boolean;
}

const p = new Vector3();
/** 월드 격자 키: 칸 좌표 각 축 ±512 칸까지 */
const W_OFFSET = 512;
const W_STRIDE = 1024;
/** 셀 키 = (cx + OFFSET) * STRIDE + (cy + OFFSET): 화면 밖 음수 셀도 겹치지 않게 */
const OFFSET = 1024;
const STRIDE = 4096;

export class MoneyPopups {
  private readonly root = document.createElement('div');
  /** 화면 중앙의 큰 숫자 (피날레 정산) */
  private readonly big = document.createElement('div');
  private readonly popups: Popup[] = [];
  private readonly bins = new Map<number, Bin>();
  private readonly spare: Bin[] = [];
  private readonly pending = new Map<number, WorldCell>();
  private readonly spareCells: WorldCell[] = [];
  private next = 0;
  /** 성능 측정: 마지막 update에 쓴 시간 (ms). add는 Economy 지급 시간에 들어간다 */
  lastMs = 0;

  constructor(private readonly camera: PerspectiveCamera) {
    this.root.className = 'money-popups';
    for (let i = 0; i < ECONOMY.popupMax; i++) {
      const el = document.createElement('div');
      el.className = 'money-popup';
      el.hidden = true;
      this.root.append(el);
      this.popups.push({ el, age: Infinity, x: 0, y: 0, scale: 1 });
    }
    this.big.className = 'money-big';
    this.big.hidden = true;
    this.root.append(this.big);
    document.body.append(this.root);
  }

  /** 화면 중앙에 크게: '+$12,345' 와 설명 한 줄 (CSS 애니메이션으로 터졌다가 사라진다) */
  showBig(amount: number, label: string): void {
    this.big.replaceChildren();
    const value = document.createElement('div');
    value.textContent = `+${formatMoney(amount)}`;
    const caption = document.createElement('div');
    caption.className = 'money-big-label';
    caption.textContent = label;
    this.big.append(value, caption);
    this.big.hidden = false;
    // Web Animations: 강제 레이아웃 없이 처음부터 (터졌다가 위로 사라진다)
    this.big.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.25)', offset: 0.12 },
        { transform: 'translate(-50%, -50%) scale(1)', offset: 0.22 },
        { opacity: 1, transform: 'translate(-50%, -60%) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -70%) scale(0.95)' },
      ],
      { duration: 3200, easing: 'ease-out', fill: 'forwards' },
    );
  }

  /** 지급 하나 (월드 위치). 월드 격자 칸에 더하기만 한다 (투영은 update에서) */
  add(x: number, y: number, z: number, amount: number, rare: boolean): void {
    const w = ECONOMY.popupWorldCellM;
    const key =
      ((Math.floor(x / w) + W_OFFSET) * W_STRIDE + Math.floor(y / w) + W_OFFSET) * W_STRIDE +
      Math.floor(z / w) +
      W_OFFSET;
    let cell = this.pending.get(key);
    if (!cell) {
      cell = this.spareCells.pop() ?? { key, amount: 0, wx: 0, wy: 0, wz: 0, rare: false };
      cell.key = key;
      cell.amount = 0;
      cell.wx = 0;
      cell.wy = 0;
      cell.wz = 0;
      cell.rare = false;
      this.pending.set(key, cell);
    }
    cell.amount += amount;
    cell.wx += x * amount;
    cell.wy += y * amount;
    cell.wz += z * amount;
    cell.rare ||= rare;
  }

  /** 월드 격자 칸 하나를 화면 셀 묶음에 넣는다 */
  private toScreen(cell: WorldCell): void {
    const amount = cell.amount;
    p.set(cell.wx / amount, cell.wy / amount, cell.wz / amount).project(this.camera);
    if (p.z > 1) return; // 카메라 뒤
    const rare = cell.rare;
    const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-p.y * 0.5 + 0.5) * window.innerHeight;
    const px = ECONOMY.popupCellPx;
    const key = (Math.floor(sx / px) + OFFSET) * STRIDE + Math.floor(sy / px) + OFFSET;
    let bin = this.bins.get(key);
    if (!bin) {
      bin = this.spare.pop() ?? { key, age: 0, amount: 0, sx: 0, sy: 0, rare: false };
      bin.key = key;
      bin.age = 0;
      bin.amount = 0;
      bin.sx = 0;
      bin.sy = 0;
      bin.rare = false;
      this.bins.set(key, bin);
    }
    bin.amount += amount;
    bin.sx += sx * amount;
    bin.sy += sy * amount;
    bin.rare ||= rare;
  }

  /** 렌더 프레임마다 (실제 시간) */
  update(dt: number): void {
    const t = performance.now();
    for (const cell of this.pending.values()) {
      if (cell.amount > 0) this.toScreen(cell);
      this.spareCells.push(cell);
    }
    this.pending.clear();
    for (const bin of this.bins.values()) {
      bin.age += dt;
      if (bin.age < ECONOMY.popupBinSec) continue;
      this.show(bin);
      this.bins.delete(bin.key);
      this.spare.push(bin);
    }
    const life = ECONOMY.popupLifeSec;
    for (const pop of this.popups) {
      if (pop.age >= life) continue;
      pop.age += dt;
      if (pop.age >= life) {
        pop.el.hidden = true;
        continue;
      }
      const k = pop.age / life;
      const pop0 = Math.min(1, pop.age / 0.12); // 처음에 톡 튀어나오게
      const s = pop.scale * (0.6 + 0.4 * pop0 + 0.15 * (1 - pop0));
      pop.el.style.transform = `translate(${pop.x}px, ${pop.y - ECONOMY.popupRisePx * k}px) translate(-50%, -50%) scale(${s})`;
      pop.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
    this.lastMs = performance.now() - t;
  }

  /** 건물 교체: 대기 중인 묶음과 떠 있는 숫자를 지운다 */
  clear(): void {
    this.big.hidden = true;
    for (const bin of this.bins.values()) this.spare.push(bin);
    this.bins.clear();
    for (const cell of this.pending.values()) this.spareCells.push(cell);
    this.pending.clear();
    for (const pop of this.popups) {
      pop.age = Infinity;
      pop.el.hidden = true;
    }
  }

  private show(bin: Bin): void {
    if (bin.amount <= 0) return;
    // 비어 있는 칸, 없으면 가장 오래된 칸 (순서대로 돌아가며)
    let pop = this.popups.find((q) => q.age >= ECONOMY.popupLifeSec);
    if (!pop) {
      pop = this.popups[this.next]!;
      this.next = (this.next + 1) % this.popups.length;
    }
    const big = bin.amount >= ECONOMY.popupBigAmount;
    pop.age = 0;
    pop.x = bin.sx / bin.amount;
    pop.y = bin.sy / bin.amount;
    pop.scale = Math.min(
      ECONOMY.popupMaxScale,
      1 + Math.log10(1 + bin.amount / ECONOMY.popupBigAmount),
    );
    pop.el.textContent = `+${formatMoney(bin.amount)}`;
    pop.el.className = `money-popup${big ? ' big' : ''}${bin.rare ? ' rare' : ''}`;
    pop.el.hidden = false;
  }
}

// 경제 HUD (왼쪽 위): 현재 돈(굴러가는 카운터), 이번 건물 수익, 파괴율 바(완파 임계값 표시).
import { ECONOMY, FINALE } from '../config';
import type { Economy } from '../economy/Economy';
import { formatMoney } from './format';

export class EconomyHud {
  private readonly root = document.createElement('div');
  private readonly money = document.createElement('div');
  private readonly building = document.createElement('div');
  private readonly barFill = document.createElement('div');
  private readonly barLabel = document.createElement('div');
  /** 화면에 보이는 돈 (실제 돈을 굴러가며 따라간다) */
  private shown = 0;
  private lastText = '';

  constructor() {
    this.root.className = 'eco-hud';
    this.money.className = 'eco-money';
    this.building.className = 'eco-building';
    const bar = document.createElement('div');
    bar.className = 'eco-bar';
    this.barFill.className = 'eco-bar-fill';
    const mark = document.createElement('div');
    mark.className = 'eco-bar-mark';
    mark.style.left = `${FINALE.threshold * 100}%`;
    mark.title = `Complete at ${Math.round(FINALE.threshold * 100)}%`;
    bar.append(this.barFill, mark);
    this.barLabel.className = 'eco-bar-label';
    this.root.append(this.money, this.building, bar, this.barLabel);
    document.body.append(this.root);
  }

  /** 렌더 프레임마다 (실제 시간) */
  update(dt: number, economy: Economy): void {
    const target = economy.wallet.money;
    const gap = target - this.shown;
    if (gap !== 0) {
      // 지수 스무딩 + 최소 속도: 큰 수익은 빠르게 굴러가고 작은 차이도 금방 맞춰진다
      const k = 1 - Math.exp(-dt / ECONOMY.counterSmoothingSec);
      const step = Math.max(Math.abs(gap) * k, ECONOMY.counterMinSpeed * dt);
      this.shown = Math.abs(gap) <= step ? target : this.shown + Math.sign(gap) * step;
    }
    const text = formatMoney(this.shown);
    if (text !== this.lastText) {
      this.money.textContent = text;
      this.lastText = text;
      this.money.classList.toggle('rolling', this.shown !== target);
    }
    this.building.textContent = `This building ${formatMoney(economy.wallet.buildingTotal)}`;
    const rate = economy.destructionRate;
    this.barFill.style.width = `${rate * 100}%`;
    this.barFill.classList.toggle('done', rate >= FINALE.threshold);
    this.barLabel.textContent = `Destroyed ${Math.floor(rate * 100)}%`;
  }
}

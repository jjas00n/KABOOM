// 주문 게시판 (ORDER_BOARD): 의뢰 카드 3장 + 지갑·누적 통계 + 품질 선택. 스타일은 index.html의 .board
import { QUALITY_PRESETS, type QualityPreset } from '../config';
import type { CareerData } from '../orders/Career';
import type { Order, OrderTier, OrderTrait } from '../orders/Order';
import { formatMoney } from './format';
import type { OrderThumbnails } from './OrderThumbnails';

const TIER_LABEL: Record<OrderTier, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const TRAIT_LABEL: Record<OrderTrait, [string, string]> = {
  glassy: ['Glass-heavy', 'Shatters easily, but glass pays half'],
  slender: ['Tall & slender', 'Topples easily'],
  sprawling: ['Low & wide', 'Lots of fragments to break'],
  reinforced: ['Reinforced', 'Tough pieces, pays more'],
};
const QUALITY_LABEL: Record<QualityPreset, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export interface BoardView {
  orders: readonly Order[];
  quality: QualityPreset;
  money: number;
  career: CareerData;
}

export class OrderBoard {
  private readonly root = document.createElement('div');
  private readonly summary = document.createElement('div');
  private readonly cards = document.createElement('div');
  private readonly quality = document.createElement('select');

  /** onPick: 카드를 골랐다, onQuality: 품질 설정 변경 */
  constructor(
    private readonly thumbnails: OrderThumbnails,
    private readonly onPick: (order: Order) => void,
    onQuality: (q: QualityPreset) => void,
  ) {
    this.root.className = 'board';
    this.root.hidden = true;
    // 게시판 위 클릭·휠이 캔버스(발사·스킵·카메라)로 새지 않게
    for (const type of ['pointerdown', 'click', 'wheel'] as const) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    const header = document.createElement('div');
    header.className = 'board-header';
    const title = document.createElement('div');
    title.className = 'board-title';
    title.textContent = 'Demolition orders';
    const label = document.createElement('label');
    label.className = 'board-quality';
    label.append('Quality ');
    for (const q of Object.keys(QUALITY_PRESETS) as QualityPreset[]) {
      const option = document.createElement('option');
      option.value = q;
      option.textContent = QUALITY_LABEL[q];
      this.quality.append(option);
    }
    this.quality.addEventListener('change', () => {
      onQuality(this.quality.value as QualityPreset);
      this.quality.blur();
    });
    label.append(this.quality);
    header.append(title, label);
    this.summary.className = 'board-summary';
    this.cards.className = 'board-cards';
    this.root.append(header, this.summary, this.cards);
    document.body.append(this.root);
  }

  show(view: BoardView): void {
    const { career } = view;
    this.quality.value = view.quality;
    const best = career.best
      ? ` · Best: ${career.best.name} ${formatMoney(career.best.total)}`
      : '';
    this.summary.textContent =
      `Wallet ${formatMoney(view.money)} · Demolished ${career.buildingsDemolished}` +
      ` · Fragments ${count.format(career.totalFragments)}${best}`;
    this.cards.replaceChildren(...view.orders.map((o) => this.card(o, view.quality)));
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private card(order: Order, quality: QualityPreset): HTMLElement {
    const card = document.createElement('div');
    card.className = `board-card tier-${order.tier}`;
    const img = document.createElement('img');
    img.className = 'board-thumb';
    img.alt = order.name;
    img.src = this.thumbnails.get(order);
    const name = el('div', 'board-name', order.name);
    const client = el('div', 'board-client', `for ${order.client}`);
    const [traitName, traitText] = TRAIT_LABEL[order.trait];
    const tags = el('div', 'board-tags');
    tags.append(
      el('span', `board-tag tier`, TIER_LABEL[order.tier]),
      el('span', `board-tag trait`, traitName),
    );
    const b = order.building;
    const rows: [string, string][] = [
      ['Size', `${b.floors} floors · ${b.baysX}×${b.baysZ} bays`],
      ['Fragments', `~${count.format(order.estimatedFragments[quality])}`],
      [
        'Reward',
        `×${order.rewardMultiplier.toFixed(2)} · +${Math.round(order.completionBonus * 100)}% bonus`,
      ],
      ['Est. payout', `~${formatMoney(order.estimatedPayout[quality])}`],
    ];
    const stats = el('div', 'board-stats');
    for (const [k, v] of rows) {
      const row = el('div', 'board-row');
      row.append(el('span', '', k), el('span', '', v));
      stats.append(row);
    }
    const take = document.createElement('button');
    take.className = 'hud-button hud-button-primary board-take';
    take.textContent = 'Take order';
    take.addEventListener('click', () => {
      take.blur();
      this.onPick(order);
    });
    card.append(img, name, client, tags, el('div', 'board-trait', traitText), stats, take);
    return card;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

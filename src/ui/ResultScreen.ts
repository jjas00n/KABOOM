// 완파 피날레 UI: 화면 중앙 'DEMOLISHED!' 배너 + 결과 화면 (이번 건물 수익 분리, 발사 수, 시간, 최대 연쇄).
import type { LauncherId } from '../game/Launcher';
import type { IncomeSource } from '../economy/Wallet';
import { formatMoney } from './format';

export interface ResultData {
  income: Record<IncomeSource, number>;
  total: number;
  shots: Record<LauncherId, number>;
  seconds: number;
  maxChain: number;
}

export class FinaleBanner {
  private readonly el = document.createElement('div');

  constructor() {
    this.el.className = 'finale-banner';
    this.el.textContent = 'DEMOLISHED!';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  show(): void {
    this.el.hidden = false;
    // Web Animations: CSS 클래스 재시작(offsetWidth 강제 레이아웃) 없이 처음부터
    this.el.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(2.4)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(0.95)', offset: 0.1 },
        { transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.16 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.75 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.1)' },
      ],
      { duration: 2600, easing: 'ease-out', fill: 'forwards' },
    );
  }

  hide(): void {
    this.el.hidden = true;
  }
}

export class ResultScreen {
  private readonly root = document.createElement('div');
  private readonly rows = document.createElement('div');
  private readonly next = document.createElement('button');

  /** onNext: '다음 주문' */
  constructor(onNext: () => void) {
    this.root.className = 'result';
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'Demolition complete';
    this.rows.className = 'result-rows';
    this.next.className = 'hud-button hud-button-primary result-next';
    this.next.textContent = 'Next order';
    this.next.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.next.addEventListener('click', (e) => {
      e.stopPropagation();
      this.next.blur();
      onNext();
    });
    this.root.append(title, this.rows, this.next);
    this.root.hidden = true;
    document.body.append(this.root);
  }

  show(r: ResultData): void {
    const shots = r.shots.cannon + r.shots.wizard;
    const pct = (n: number) => (shots > 0 ? Math.round((n / shots) * 100) : 0);
    const min = Math.floor(r.seconds / 60);
    const sec = Math.floor(r.seconds % 60);
    const lines: [string, string, string?][] = [
      ['Debris income', formatMoney(r.income.fragments)],
      ['Finale', formatMoney(r.income.finale)],
      ['Completion bonus', formatMoney(r.income.bonus)],
      ['Total', formatMoney(r.total), 'total'],
      ['Shots', `${shots}  (cannon ${pct(r.shots.cannon)}% · wizard ${pct(r.shots.wizard)}%)`],
      ['Time', `${min}:${String(sec).padStart(2, '0')}`],
      ['Biggest chain collapse', `${r.maxChain} pieces`],
    ];
    this.rows.replaceChildren(
      ...lines.map(([label, value, cls]) => {
        const row = document.createElement('div');
        row.className = `result-row${cls ? ` ${cls}` : ''}`;
        const a = document.createElement('span');
        a.textContent = label;
        const b = document.createElement('span');
        b.textContent = value;
        row.append(a, b);
        return row;
      }),
    );
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

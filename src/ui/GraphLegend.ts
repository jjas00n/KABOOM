// 구조 그래프 디버그(Show graph) 색 범례: 화면 왼쪽 아래 구석
import { Color } from 'three';
import { DEBUG } from '../config';

const css = (hex: number) => `#${new Color(hex).getHexString()}`;

export class GraphLegend {
  private readonly root = document.createElement('div');

  constructor() {
    this.root.className = 'graph-legend';
    const rows: [string, string][] = [
      [css(DEBUG.anchorColor), 'Anchor (fixed to ground)'],
      [css(DEBUG.edgeColorIdle), 'Joint, no load'],
      [css(DEBUG.edgeColorLow), 'Load low'],
      [
        `linear-gradient(90deg, ${css(DEBUG.edgeColorLow)}, ${css(DEBUG.edgeColorHigh)})`,
        'Load → capacity',
      ],
      [css(DEBUG.edgeColorHigh), 'Overloaded (about to break)'],
    ];
    for (const [swatch, label] of rows) {
      const row = document.createElement('div');
      const chip = document.createElement('span');
      chip.style.background = swatch;
      row.append(chip, label);
      this.root.append(row);
    }
    this.root.hidden = true;
    document.body.append(this.root);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }
}

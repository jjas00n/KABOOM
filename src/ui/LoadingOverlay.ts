// 로딩 진행률 표시 (스타일은 index.html의 .loading)
export class LoadingOverlay {
  private readonly root = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly fill = document.createElement('div');

  constructor() {
    this.root.className = 'loading';
    this.root.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    bar.append(this.fill);
    this.root.append(this.label, bar);
    document.body.append(this.root);
  }

  show(text: string): void {
    this.label.textContent = text;
    this.fill.style.width = '0%';
    this.root.hidden = false;
  }

  /** fraction: 0 ~ 1 */
  progress(fraction: number, text?: string): void {
    if (text !== undefined) this.label.textContent = text;
    this.fill.style.width = `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

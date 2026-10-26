// 프레임 구간별 CPU 시간 측정 (디버그 GUI용). 매 프레임 할당 없음.
// render는 WebGL 명령 제출까지의 CPU 시간이다 (GPU 실행 시간은 FPS로 간접 확인).
export const SECTIONS = ['physics', 'update', 'sync', 'render'] as const;
export type Section = (typeof SECTIONS)[number];

export class FrameTimer {
  /** 마지막 샘플 구간의 프레임당 평균 ms, 물리 스텝 수 */
  readonly avg: Record<Section, number> & { frame: number; steps: number } = {
    physics: 0,
    update: 0,
    sync: 0,
    render: 0,
    frame: 0,
    steps: 0,
  };
  private readonly acc = new Float64Array(SECTIONS.length);
  private steps = 0;
  private frames = 0;
  private frameTime = 0;

  /** start = performance.now() 로 잰 구간 시작 시각 */
  add(section: Section, start: number): void {
    this.acc[SECTIONS.indexOf(section)]! += performance.now() - start;
  }

  countStep(): void {
    this.steps++;
  }

  endFrame(realDt: number): void {
    this.frames++;
    this.frameTime += realDt * 1000;
  }

  /** 누적값을 평균으로 바꾸고 비운다 */
  flush(): void {
    if (this.frames === 0) return;
    SECTIONS.forEach((s, i) => {
      this.avg[s] = round2(this.acc[i]! / this.frames);
      this.acc[i] = 0;
    });
    this.avg.steps = round2(this.steps / this.frames);
    this.avg.frame = round2(this.frameTime / this.frames);
    this.steps = 0;
    this.frames = 0;
    this.frameTime = 0;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

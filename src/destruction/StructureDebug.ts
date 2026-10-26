// 디버그: 구조 그래프 엣지(하중률 색) + 앵커 점. 켜져 있을 때만 주기적으로 다시 만든다.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type Scene,
} from 'three';
import type { StructureGraph } from '../building/StructureGraph';
import { DEBUG } from '../config';

const LOW = new Color(DEBUG.edgeColorLow);
const HIGH = new Color(DEBUG.edgeColorHigh);
const IDLE = new Color(DEBUG.edgeColorIdle);

export class StructureDebug {
  private readonly lines: LineSegments;
  private readonly anchors: Points;
  private readonly linePos: Float32Array;
  private readonly lineColor: Float32Array;
  private elapsed = 0;
  private enabled = false;

  constructor(
    private readonly scene: Scene,
    private readonly graph: StructureGraph,
    private readonly positions: ArrayLike<number>,
  ) {
    this.linePos = new Float32Array(graph.edgeCount * 6);
    this.lineColor = new Float32Array(graph.edgeCount * 6);
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(this.linePos, 3));
    lineGeo.setAttribute('color', new BufferAttribute(this.lineColor, 3));
    this.lines = new LineSegments(
      lineGeo,
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    );
    this.lines.renderOrder = 1;
    this.lines.frustumCulled = false;

    const anchorPos: number[] = [];
    for (let i = 0; i < graph.nodeCount; i++) {
      if (graph.anchor[i])
        anchorPos.push(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    }
    const anchorGeo = new BufferGeometry();
    anchorGeo.setAttribute('position', new BufferAttribute(Float32Array.from(anchorPos), 3));
    this.anchors = new Points(
      anchorGeo,
      new PointsMaterial({ color: DEBUG.anchorColor, size: DEBUG.anchorSize, depthTest: false }),
    );
    this.anchors.renderOrder = 1;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.scene.add(this.lines, this.anchors);
      this.rebuild();
    } else {
      this.scene.remove(this.lines, this.anchors);
    }
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.elapsed += dt;
    if (this.elapsed < DEBUG.graphRefreshSec) return;
    this.elapsed = 0;
    this.rebuild();
  }

  dispose(): void {
    this.setEnabled(false);
    this.lines.geometry.dispose();
    this.anchors.geometry.dispose();
  }

  /** 서 있는 구조의 살아 있는 엣지만. 색: 하중 없음 = 회색, 하중률 0 → 1 = 초록 → 빨강 */
  private rebuild(): void {
    const g = this.graph;
    const p = this.positions;
    const color = new Color();
    let n = 0;
    for (let e = 0; e < g.edgeCount; e++) {
      const a = g.edgeA[e]!;
      const b = g.edgeB[e]!;
      if (!g.alive[e] || !g.attached[a] || !g.attached[b]) continue;
      const demand = g.demand[e]!;
      if (demand <= 0) color.copy(IDLE);
      else color.lerpColors(LOW, HIGH, Math.min(demand / g.capacity[e]!, 1));
      for (const node of [a, b]) {
        this.linePos[n * 3] = p[node * 3]!;
        this.linePos[n * 3 + 1] = p[node * 3 + 1]!;
        this.linePos[n * 3 + 2] = p[node * 3 + 2]!;
        color.toArray(this.lineColor, n * 3);
        n++;
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
  }
}

// 구조 무결성 그래프: 조각=노드, 인접=엣지, 앵커
// 엣지 강도(capacity, kg) = 공유 면적 × strengthPerArea × 재질 계수 (× 부재 이음 계수).
// 순수 데이터 + 알고리즘 (three/Rapier 의존 없음, 단위 테스트 대상).
//
// 지지 규칙: 외장재(외벽 패널·유리·난간)는 구조재에 매달려 지지를 받지만 구조재를 떠받치지 않는다.
// 지지를 퍼뜨릴 때 '외장재 → 구조재' 방향은 막는다.
//
// 하중 경로: 앵커에서 '중력 가중' 최단 경로(Dijkstra). 아래로 내려가는 엣지는 싸고, 옆으로는 비싸고,
// 위로 매달리는 엣지는 더 비싸다. 하중은 이 거리가 더 짧은(앵커에 더 가까운) 이웃에게만 내려보낸다.
// (단순 hop 수 BFS는 작은 손상에도 먼 노드들의 '가장 가까운 지지'가 바뀌어 하중이 엉뚱한 곳에 몰렸다)
import { CONCRETE, GLASS, STRUCTURE } from '../config';
import { MATERIAL, type Fragment } from '../fracture/Fragment';

interface Edge {
  a: number;
  b: number;
  area: number;
  capacity: number;
  length: number;
  /** b.y - a.y */
  rise: number;
}

export interface NodeInfo {
  anchor: boolean;
  cladding: boolean;
}

export class StructureGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly edgeA: Uint32Array;
  readonly edgeB: Uint32Array;
  readonly area: Float32Array;
  /** 엣지가 버티는 하중 (kg). 멀쩡한 상태 하중으로 보정된 값 */
  readonly capacity: Float32Array;
  /** 하중 분배 비율용 기하 강도 (보정 전 capacity). 보정이 분배를 바꾸지 않게 따로 둔다. */
  readonly weight: Float32Array;
  readonly alive: Uint8Array;
  /** 노드별 붙은 엣지 (CSR) */
  readonly incidentStart: Uint32Array;
  readonly incident: Uint32Array;
  readonly mass: Float32Array;
  readonly anchor: Uint8Array;
  readonly cladding: Uint8Array;
  /** 서 있는 구조에 속하면 1. 떨어져 나간 노드(덩어리/잔해)는 0 */
  readonly attached: Uint8Array;

  /** solveSupport 결과: 앵커로부터 중력 가중 거리, 지지 못 받으면 Infinity */
  readonly dist: Float32Array;
  /** 엣지 길이와 a → b 높이 차 (yB - yA) */
  readonly edgeLength: Float32Array;
  readonly edgeRise: Float32Array;
  /** computeLoads 결과: 엣지가 실어 나르는 하중 (kg, 질량 보존) */
  readonly load: Float32Array;
  /**
   * computeLoads 결과: 강도와 비교할 요구량 = load × (1 + cantileverFactor × 지렛대 길이).
   * 옆으로 멀리 실어 나를수록(캔틸레버) 커진다. 모서리 기둥이 빠지면 여기서 차이가 난다.
   */
  readonly demand: Float32Array;
  /** computeLoads 결과: 노드 하중이 수직 지지까지 옆으로 이동하는 거리 (m) */
  readonly lever: Float32Array;

  private readonly queue: Int32Array;
  private readonly heap: Int32Array;
  private readonly heapPos: Int32Array;
  private readonly nodeLoad: Float64Array;
  private readonly stamp: Int32Array;
  private stampId = 0;

  private constructor(
    nodeCount: number,
    edges: Edge[],
    mass: Float32Array,
    anchor: Uint8Array,
    cladding: Uint8Array,
  ) {
    this.nodeCount = nodeCount;
    this.edgeCount = edges.length;
    this.edgeA = Uint32Array.from(edges, (e) => e.a);
    this.edgeB = Uint32Array.from(edges, (e) => e.b);
    this.area = Float32Array.from(edges, (e) => e.area);
    this.capacity = Float32Array.from(edges, (e) => e.capacity);
    this.weight = Float32Array.from(edges, (e) => e.capacity);
    this.edgeLength = Float32Array.from(edges, (e) => e.length);
    this.edgeRise = Float32Array.from(edges, (e) => e.rise);
    this.alive = new Uint8Array(edges.length).fill(1);
    this.load = new Float32Array(edges.length);
    this.demand = new Float32Array(edges.length);
    this.lever = new Float32Array(nodeCount);
    this.mass = mass;
    this.anchor = anchor;
    this.cladding = cladding;
    this.attached = new Uint8Array(nodeCount).fill(1);
    this.dist = new Float32Array(nodeCount);
    this.queue = new Int32Array(nodeCount);
    this.heap = new Int32Array(nodeCount);
    this.heapPos = new Int32Array(nodeCount);
    this.nodeLoad = new Float64Array(nodeCount);
    this.stamp = new Int32Array(nodeCount);

    this.incidentStart = new Uint32Array(nodeCount + 1);
    for (const e of edges) {
      this.incidentStart[e.a + 1]!++;
      this.incidentStart[e.b + 1]!++;
    }
    for (let i = 0; i < nodeCount; i++) this.incidentStart[i + 1]! += this.incidentStart[i]!;
    const fill = this.incidentStart.slice(0, nodeCount);
    this.incident = new Uint32Array(edges.length * 2);
    edges.forEach((e, k) => {
      this.incident[fill[e.a]!++] = k;
      this.incident[fill[e.b]!++] = k;
    });
  }

  /**
   * 조각 이웃 정보로 그래프를 만든다. 같은 부재 안 엣지는 그대로, 부재 사이 엣지는 jointFactor만큼 약하게.
   * 만든 뒤 멀쩡한 상태의 하중으로 강도를 보정(calibrate)해 자중으로는 무너지지 않게 한다.
   */
  static fromFragments(
    frags: readonly Fragment[],
    info: (index: number) => NodeInfo,
    intactSafety: number = STRUCTURE.intactSafety,
  ): StructureGraph {
    const n = frags.length;
    const mass = new Float32Array(n);
    const anchor = new Uint8Array(n);
    const cladding = new Uint8Array(n);
    const factor = (f: Fragment) =>
      f.material === MATERIAL.glass
        ? STRUCTURE.materialFactor.glass
        : STRUCTURE.materialFactor.concrete;
    frags.forEach((f, i) => {
      mass[i] = f.volume * (f.material === MATERIAL.glass ? GLASS.density : CONCRETE.density);
      const node = info(i);
      anchor[i] = node.anchor ? 1 : 0;
      cladding[i] = node.cladding ? 1 : 0;
    });

    const edges: Edge[] = [];
    frags.forEach((f, i) => {
      f.neighbors.forEach((j, k) => {
        if (j <= i) return; // 이웃 관계는 대칭이라 한쪽에서만
        const g = frags[j]!;
        const area = f.neighborAreas[k]!;
        const joint = f.member === g.member ? 1 : STRUCTURE.jointFactor;
        const capacity = area * STRUCTURE.strengthPerArea * Math.min(factor(f), factor(g)) * joint;
        const a = f.centroid;
        const b = g.centroid;
        const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        edges.push({ a: i, b: j, area, capacity, length, rise: b.y - a.y });
      });
    });

    const graph = new StructureGraph(n, edges, mass, anchor, cladding);
    graph.solveSupport();
    graph.computeLoads();
    for (let e = 0; e < graph.edgeCount; e++) {
      graph.capacity[e] = Math.max(graph.capacity[e]!, graph.demand[e]! * intactSafety);
    }
    return graph;
  }

  other(e: number, i: number): number {
    return this.edgeA[e] === i ? this.edgeB[e]! : this.edgeA[e]!;
  }

  /** u가 v를 떠받칠 수 있는지 (외장재는 구조재를 떠받치지 않는다) */
  canSupport(u: number, v: number): boolean {
    return !(this.cladding[u] && !this.cladding[v]);
  }

  breakEdge(e: number): boolean {
    if (!this.alive[e]) return false;
    this.alive[e] = 0;
    this.load[e] = 0;
    this.demand[e] = 0;
    return true;
  }

  /** 노드를 구조에서 떼어낸다: 모든 엣지를 끊고 attached = 0. 앵커는 떼지 않는다. */
  detach(i: number): boolean {
    if (!this.attached[i] || this.anchor[i]) return false;
    this.attached[i] = 0;
    for (let k = this.incidentStart[i]!; k < this.incidentStart[i + 1]!; k++) {
      this.breakEdge(this.incident[k]!);
    }
    return true;
  }

  /**
   * 섬(덩어리)을 구조에서 떼어낸다. 섬 안 엣지는 덩어리 결속용으로 남기고 바깥과의 엣지만 끊는다.
   * 반환: 끊긴 엣지 너머의 (아직 붙어 있는) 노드들
   */
  detachIsland(nodes: readonly number[]): number[] {
    const id = this.nextStamp();
    for (const i of nodes) this.stamp[i] = id;
    const boundary = new Set<number>();
    for (const i of nodes) {
      this.attached[i] = 0;
      for (let k = this.incidentStart[i]!; k < this.incidentStart[i + 1]!; k++) {
        const e = this.incident[k]!;
        if (!this.alive[e]) continue;
        const j = this.other(e, i);
        if (this.stamp[j] === id) continue;
        this.breakEdge(e);
        if (this.attached[j]) boundary.add(j);
      }
    }
    return [...boundary];
  }

  /**
   * 앵커에서 중력 가중 최단 거리(dist)를 구한다 (Dijkstra, 이진 힙). 반환: 지지받는 노드 수.
   * 엣지 u → v 비용 = supportCost: v가 u 위에 얹혀 있으면 싸고, 옆이면 비싸고, 매달리면 더 비싸다.
   */
  solveSupport(): number {
    this.dist.fill(Infinity);
    this.heapPos.fill(-1);
    let size = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.anchor[i] && this.attached[i]) {
        this.dist[i] = 0;
        size = this.heapPush(i, size);
      }
    }
    let supported = 0;
    while (size > 0) {
      const u = this.heap[0]!;
      size = this.heapPop(size);
      supported++;
      const du = this.dist[u]!;
      for (let k = this.incidentStart[u]!; k < this.incidentStart[u + 1]!; k++) {
        const e = this.incident[k]!;
        if (!this.alive[e]) continue;
        const v = this.other(e, u);
        if (!this.attached[v] || this.heapPos[v] === -2 || !this.canSupport(u, v)) continue;
        const nd = du + this.supportCost(e, u);
        if (nd >= this.dist[v]!) continue;
        this.dist[v] = nd;
        if (this.heapPos[v]! >= 0) this.heapUp(this.heapPos[v]!);
        else size = this.heapPush(v, size);
      }
    }
    return supported;
  }

  /** u가 이웃 v를 받칠 때 경로 비용 (엣지 길이에 방향 가중) */
  supportCost(e: number, u: number): number {
    const len = this.edgeLength[e]!;
    const rise = this.edgeA[e] === u ? this.edgeRise[e]! : -this.edgeRise[e]!; // v.y - u.y
    const horizontal = len > 0 ? Math.sqrt(Math.max(len * len - rise * rise, 0)) / len : 0;
    const hang = rise < 0 ? -rise * STRUCTURE.hangCost : 0;
    return len * (1 + STRUCTURE.lateralCost * horizontal) + hang + STRUCTURE.hopCost;
  }

  /** 엣지의 수평 길이 (m) */
  horizontalLength(e: number): number {
    const len = this.edgeLength[e]!;
    const rise = this.edgeRise[e]!;
    return Math.sqrt(Math.max(len * len - rise * rise, 0));
  }

  isSupported(i: number): boolean {
    return this.dist[i]! < Infinity;
  }

  /** solveSupport 뒤: 붙어 있지만 지지 못 받는 노드들을 살아 있는 엣지로 이어진 덩어리별로 */
  findIslands(): number[][] {
    const islands: number[][] = [];
    const id = this.nextStamp();
    for (let s = 0; s < this.nodeCount; s++) {
      if (!this.attached[s] || this.isSupported(s) || this.stamp[s] === id) continue;
      const island: number[] = [];
      this.stamp[s] = id;
      let head = 0;
      let tail = 0;
      this.queue[tail++] = s;
      while (head < tail) {
        const u = this.queue[head++]!;
        island.push(u);
        for (let k = this.incidentStart[u]!; k < this.incidentStart[u + 1]!; k++) {
          const e = this.incident[k]!;
          if (!this.alive[e]) continue;
          const v = this.other(e, u);
          if (!this.attached[v] || this.isSupported(v) || this.stamp[v] === id) continue;
          this.stamp[v] = id;
          this.queue[tail++] = v;
        }
      }
      islands.push(island);
    }
    return islands;
  }

  /**
   * 하중 근사: 앵커에서 먼 노드부터, 자기 하중(자중 + 위에서 받은 하중)을 앵커에 더 가까운
   * (dist가 작은) 이웃들에게 '기하 강도 / 경로 비용' 비율로 나눠 내려보낸다. solveSupport 뒤에 부른다.
   * dist 내림차순으로 처리하므로 받은 쪽은 항상 나중에 처리된다 (질량 보존).
   */
  computeLoads(): void {
    this.load.fill(0);
    this.demand.fill(0);
    let count = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      if (!this.attached[i] || !this.isSupported(i)) continue;
      this.nodeLoad[i] = this.mass[i]!;
      this.queue[count++] = i;
    }
    const order = this.queue.subarray(0, count);
    order.sort((a, b) => this.dist[b]! - this.dist[a]!);

    // 지렛대: 앵커 쪽(dist 오름차순)부터, 부모 중 가장 짧은 (부모 지렛대 + 엣지의 수평 길이)
    for (let k = count - 1; k >= 0; k--) {
      const i = order[k]!;
      if (this.anchor[i]) {
        this.lever[i] = 0;
        continue;
      }
      let best = Infinity;
      for (let q = this.incidentStart[i]!; q < this.incidentStart[i + 1]!; q++) {
        const e = this.incident[q]!;
        const p = this.parentOf(e, i);
        if (p >= 0) best = Math.min(best, this.lever[p]! + this.horizontalLength(e));
      }
      this.lever[i] = best < Infinity ? best : 0;
    }

    for (let k = 0; k < count; k++) {
      const i = order[k]!;
      if (this.anchor[i]) continue; // 앵커가 받아낸다
      let total = 0;
      for (let q = this.incidentStart[i]!; q < this.incidentStart[i + 1]!; q++) {
        const e = this.incident[q]!;
        const p = this.parentOf(e, i);
        if (p >= 0) total += this.weight[e]! / this.supportCost(e, p);
      }
      if (total <= 0) continue;
      const share = this.nodeLoad[i]! / total;
      for (let q = this.incidentStart[i]!; q < this.incidentStart[i + 1]!; q++) {
        const e = this.incident[q]!;
        const p = this.parentOf(e, i);
        if (p < 0) continue;
        const portion = (share * this.weight[e]!) / this.supportCost(e, p);
        this.load[e] = portion;
        this.demand[e] = portion * (1 + STRUCTURE.cantileverFactor * this.lever[i]!);
        this.nodeLoad[p]! += portion;
      }
    }
  }

  /** nodes 안에서 살아 있는 엣지로 이어진 덩어리들 (떨어진 덩어리 분해용) */
  components(nodes: readonly number[]): number[][] {
    const member = this.nextStamp();
    for (const i of nodes) this.stamp[i] = member;
    const seen = this.nextStamp();
    const out: number[][] = [];
    for (const s of nodes) {
      if (this.stamp[s] !== member) continue;
      const comp: number[] = [];
      this.stamp[s] = seen;
      let head = 0;
      let tail = 0;
      this.queue[tail++] = s;
      while (head < tail) {
        const u = this.queue[head++]!;
        comp.push(u);
        for (let k = this.incidentStart[u]!; k < this.incidentStart[u + 1]!; k++) {
          const e = this.incident[k]!;
          if (!this.alive[e]) continue;
          const v = this.other(e, u);
          if (this.stamp[v] !== member) continue;
          this.stamp[v] = seen;
          this.queue[tail++] = v;
        }
      }
      out.push(comp);
    }
    return out;
  }

  /** 노드에 붙은 살아 있는 엣지 강도 합 (kg) */
  supportCapacity(i: number): number {
    let sum = 0;
    for (let k = this.incidentStart[i]!; k < this.incidentStart[i + 1]!; k++) {
      const e = this.incident[k]!;
      if (this.alive[e]) sum += this.capacity[e]!;
    }
    return sum;
  }

  /** 엣지 e가 child를 받치는 부모 엣지면 부모 노드, 아니면 -1 */
  private parentOf(e: number, child: number): number {
    if (!this.alive[e]) return -1;
    const p = this.other(e, child);
    if (!this.attached[p] || !(this.dist[p]! < this.dist[child]!) || !this.canSupport(p, child)) {
      return -1;
    }
    return p;
  }

  private heapPush(i: number, size: number): number {
    this.heap[size] = i;
    this.heapPos[i] = size;
    this.heapUp(size);
    return size + 1;
  }

  /** 최솟값을 빼고 확정 표시(-2). 반환: 새 크기 */
  private heapPop(size: number): number {
    const last = size - 1;
    this.heapPos[this.heap[0]!] = -2;
    if (last === 0) return 0;
    this.heap[0] = this.heap[last]!;
    this.heapPos[this.heap[0]!] = 0;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < last && this.dist[this.heap[l]!]! < this.dist[this.heap[m]!]!) m = l;
      if (r < last && this.dist[this.heap[r]!]! < this.dist[this.heap[m]!]!) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return last;
  }

  private heapUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.dist[this.heap[parent]!]! <= this.dist[this.heap[i]!]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.heap[i]!;
    const b = this.heap[j]!;
    this.heap[i] = b;
    this.heap[j] = a;
    this.heapPos[b] = i;
    this.heapPos[a] = j;
  }

  private nextStamp(): number {
    return ++this.stampId;
  }
}

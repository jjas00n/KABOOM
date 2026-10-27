// 지지 BFS + 하중 근사로 붕괴를 판정한다. 순수 로직 (물리/렌더는 DestructionSystem이 처리).
//
// update(dt)마다:
//   1) 구조가 바뀌었으면 앵커에서 지지 거리 재계산 → 지지를 잃은 섬을 구조에서 떼어낸다.
//      섬 경계에 붙어 있던 외장재는 덩어리에 깔려 같이 떨어져 나간다(그대로 두면 fixed 패널이 덩어리를 받쳐 버림).
//   2) 하중을 다시 계산해 강도를 넘는 엣지 목록을 만든다.
//   3) 과부하 엣지는 손상이 쌓이다 끊긴다 → 점진적 붕괴 (기둥이 빠지면 그 위가 서서히 주저앉는다).
import { STRUCTURE } from '../config';
import type { StructureGraph } from '../building/StructureGraph';

export interface CollapseEvents {
  /** 새로 지지를 잃은 섬들 (graph에서 이미 떼어냄, 섬 안 엣지는 살아 있음) */
  islands: number[][];
  /** 섬에 깔려 떨어져 나간 외장재 노드 (개별 조각) */
  crushed: number[];
}

/** 섬 떼어내기 → 외장재 떼어내기가 연달아 일어날 때 한 update에서 반복할 최대 횟수 */
const MAX_PASSES = 8;

export class CollapseSolver {
  private dirty = true;
  /** 엣지 용량만 바뀜 (화재 약화): 하중은 그대로라 과부하 목록만 다시 만든다 */
  private capacityDirty = false;
  private sinceSolve = Infinity;
  private readonly damage: Float32Array;
  private overloaded: number[] = [];

  constructor(
    readonly graph: StructureGraph,
    private readonly failureTime: number = STRUCTURE.failureTime,
  ) {
    this.damage = new Float32Array(graph.edgeCount);
  }

  /** 엣지가 끊기거나 노드가 떨어져 나갔을 때 */
  markDirty(): void {
    this.dirty = true;
  }

  /** 엣지 용량이 바뀌었을 때 (지지·하중 재계산 없이 과부하 목록만 갱신) */
  capacityChanged(): void {
    this.capacityDirty = true;
  }

  /** 현재 강도를 넘는 엣지 수 (디버그) */
  get overloadedCount(): number {
    return this.overloaded.length;
  }

  /** force: 재계산 간격(solveIntervalSec)을 무시하고 바로 (폭발 직후) */
  update(dt: number, force = false): CollapseEvents {
    const events: CollapseEvents = { islands: [], crushed: [] };
    const g = this.graph;
    this.sinceSolve += dt;
    const solveNow = this.dirty && (force || this.sinceSolve >= STRUCTURE.solveIntervalSec);
    const changed = solveNow;
    if (solveNow) this.sinceSolve = 0;

    for (let pass = 0; solveNow && pass < MAX_PASSES && this.dirty; pass++) {
      this.dirty = false;
      g.solveSupport();
      for (const island of g.findIslands()) {
        events.islands.push(island);
        for (const j of g.detachIsland(island)) {
          if (g.cladding[j] && g.detach(j)) {
            events.crushed.push(j);
            this.dirty = true;
          }
        }
      }
    }
    if (solveNow && this.dirty) g.solveSupport(); // MAX_PASSES를 다 쓴 경우에도 dist는 최신으로

    if (changed || this.capacityDirty) {
      if (changed) g.computeLoads();
      this.capacityDirty = false;
      this.overloaded = [];
      for (let e = 0; e < g.edgeCount; e++) {
        if (g.alive[e] && g.demand[e]! > g.capacity[e]!) this.overloaded.push(e);
      }
    }

    // 과부하율 r: 손상 += (r - 1) × dt / failureTime. r = 2면 failureTime 뒤에 끊긴다.
    for (const e of this.overloaded) {
      if (!g.alive[e]) continue;
      const ratio = g.demand[e]! / g.capacity[e]!;
      this.damage[e]! += ((ratio - 1) * dt) / this.failureTime;
      if (this.damage[e]! >= 1) {
        g.breakEdge(e);
        this.dirty = true;
      }
    }
    return events;
  }
}

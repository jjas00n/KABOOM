// 고정 크기 파티클 풀: 링 버퍼로 가장 오래된 칸부터 덮어쓰고, 이번 프레임에 쓴 칸 범위만
// GPU 버퍼에 다시 올린다 (BufferAttribute.addUpdateRange).
import { InstancedBufferGeometry, type BufferAttribute, type BufferGeometry } from 'three';

export interface SlotRange {
  start: number;
  count: number;
}

export class ParticleRing {
  private next = 0;
  /** 이번 프레임에 처음 쓴 칸과 쓴 칸 수 */
  private first = 0;
  private written = 0;

  constructor(readonly capacity: number) {}

  /** 다음에 쓸 칸 (가장 오래된 칸) */
  allocate(): number {
    if (this.written === 0) this.first = this.next;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.written++;
    return i;
  }

  /** 이번 프레임에 쓴 칸 범위 (링 끝을 넘어가면 2개, 없으면 빈 배열) */
  dirtyRanges(): SlotRange[] {
    const { first, capacity } = this;
    const count = Math.min(this.written, capacity);
    if (count === 0) return [];
    if (count === capacity) return [{ start: 0, count: capacity }];
    if (first + count <= capacity) return [{ start: first, count }];
    return [
      { start: first, count: capacity - first },
      { start: 0, count: first + count - capacity },
    ];
  }

  /** 쓴 칸만 GPU에 다시 올리도록 표시하고 범위를 비운다 */
  flush(attributes: readonly BufferAttribute[]): void {
    const ranges = this.dirtyRanges();
    this.written = 0;
    if (ranges.length === 0) return;
    for (const a of attributes) {
      a.clearUpdateRanges();
      for (const r of ranges) a.addUpdateRange(r.start * a.itemSize, r.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

/** 파티클 하나의 모양(source)을 instanceCount개 그리는 인스턴스 지오메트리 */
export function instancedGeometry(
  source: BufferGeometry,
  instanceCount: number,
): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setIndex(source.getIndex());
  for (const [name, attribute] of Object.entries(source.attributes))
    g.setAttribute(name, attribute);
  g.instanceCount = instanceCount;
  return g;
}

// 충돌 이벤트 큐 (레코드를 재사용해 매 스텝 할당 없음)

export interface CollisionEvent {
  collider1: number;
  collider2: number;
  started: boolean;
}

export class CollisionEventQueue {
  private readonly pool: CollisionEvent[] = [];
  private count = 0;

  get length(): number {
    return this.count;
  }

  push(collider1: number, collider2: number, started: boolean): void {
    let event = this.pool[this.count];
    if (!event) {
      event = { collider1: 0, collider2: 0, started: false };
      this.pool.push(event);
    }
    event.collider1 = collider1;
    event.collider2 = collider2;
    event.started = started;
    this.count++;
  }

  /** 쌓인 이벤트를 순서대로 넘기고 비운다. 콜백 밖으로 event 참조를 보관하지 말 것(재사용됨). */
  drain(fn: (event: CollisionEvent) => void): void {
    for (let i = 0; i < this.count; i++) {
      fn(this.pool[i]!);
    }
    this.count = 0;
  }

  clear(): void {
    this.count = 0;
  }
}

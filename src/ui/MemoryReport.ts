// dev 전용 메모리 리포트: 건물 교체 정리(7-3)가 새는 게 없는지 본다.
//   스냅샷 = JS heap(Chrome performance.memory), GPU geometry/texture 수, Rapier 바디·콜라이더 수, 빌린 라이트 수
//   Soak: 주문 N번을 자동으로 (카드 0 → 로딩 → 파괴율 채우기 → 대포 발사 → 완파 → 결과 → 게시판) 돌리고
//         주문마다 IDLE·게시판 스냅샷 + 플레이 구간(IDLE → 게시판) 평균 FPS를 남긴다 (lastSoak, console.table).
//         판정: 게시판(빈 부지)은 첫 주문 뒤와 마지막 주문 뒤가 같은 수준 (자원 수 동일, heap +10% 이내),
//               IDLE은 건물마다 크기가 달라 지오메트리·텍스처·라이트만 비교한다.
// window.gc가 있으면(크롬 --js-flags=--expose-gc) 스냅샷 전에 부른다. 없으면 heap은 GC 시점에 따라 흔들린다.
import type GUI from 'lil-gui';
import type { WebGLRenderer } from 'three';
import type { Game } from '../game/Game';
import { GameState } from '../game/StateMachine';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface MemorySnapshot {
  label: string;
  heapMB: number;
  geometries: number;
  textures: number;
  bodies: number;
  rapierBodies: number;
  rapierColliders: number;
  lights: number;
  /** 게시판 행: 그 주문 플레이 구간(IDLE → 게시판) 평균 FPS */
  fps?: number;
}

/** 상태 하나를 기다리는 시간 상한 (ms): 로딩·비행·피날레가 이보다 길면 실패로 본다 */
const STATE_TIMEOUT_MS = 60_000;
/** heap 증가 허용 비율 */
const HEAP_TOLERANCE = 0.1;
const BYTES_PER_MB = 1024 * 1024;
/** 스냅샷 전에 기다리는 프레임 수 (gc 앞뒤로) */
const SETTLE_FRAMES = 10;

export class MemoryReport {
  readonly last = { heapMB: 0, geometries: 0, textures: 0, bodies: 0, colliders: 0 };
  running = false;
  /** 마지막 soak의 주문별 스냅샷 (#i idle, #i board 순) */
  lastSoak: MemorySnapshot[] = [];
  /** 마지막 soak 통과 여부 (돌기 전 null) */
  lastPass: boolean | null = null;

  constructor(
    private readonly game: Game,
    private readonly physics: PhysicsWorld,
    private readonly renderer: WebGLRenderer,
  ) {}

  snapshot(label: string): MemorySnapshot {
    (window as { gc?: () => void }).gc?.();
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    const info = this.renderer.info.memory;
    const snap: MemorySnapshot = {
      label,
      heapMB: memory ? Math.round((memory.usedJSHeapSize / BYTES_PER_MB) * 10) / 10 : NaN,
      geometries: info.geometries,
      textures: info.textures,
      bodies: this.physics.bodyCount,
      rapierBodies: this.physics.world.bodies.len(),
      rapierColliders: this.physics.world.colliders.len(),
      lights: this.game.site.lights.inUse,
    };
    Object.assign(this.last, {
      heapMB: snap.heapMB,
      geometries: snap.geometries,
      textures: snap.textures,
      bodies: snap.rapierBodies,
      colliders: snap.rapierColliders,
    });
    return snap;
  }

  /** 주문 count번 자동 진행. 반환: 통과 여부 (콘솔에 표) */
  async soak(count: number): Promise<boolean> {
    if (this.running) return false;
    const g = this.game;
    if (!g.fsm.is(GameState.ORDER_BOARD)) {
      console.warn('memory soak: start from the order board');
      return false;
    }
    this.running = true;
    const snaps: MemorySnapshot[] = [];
    try {
      for (let i = 1; i <= count; i++) {
        g.pickOrder(g.board[0]!);
        await this.until(GameState.IDLE);
        await settle();
        snaps.push(this.snapshot(`#${i} idle`));
        const frames = countFrames();
        g.fillToThreshold();
        g.requestLauncher('cannon');
        await this.until(GameState.CUTSCENE);
        g.primaryAction(); // 컷신 스킵
        await this.until(GameState.AIMING);
        g.primaryAction(); // 발사 (빗나가도 SPECTATE에서 완파가 발동)
        await this.until(GameState.FINALE);
        g.primaryAction(); // 피날레 스킵
        await this.until(GameState.RESULT);
        g.nextOrder();
        await this.until(GameState.ORDER_BOARD);
        const fps = frames.stop();
        await settle();
        snaps.push({ ...this.snapshot(`#${i} board`), fps });
      }
    } catch (err) {
      console.error('memory soak failed', err);
      this.running = false;
      return false;
    }
    this.running = false;
    const pick = (label: string) => snaps.find((s) => s.label === label)!;
    const rows = [
      pick('#1 idle'),
      pick(`#${count} idle`),
      pick('#1 board'),
      pick(`#${count} board`),
    ];
    console.table(snaps);
    // 게시판(빈 부지)은 전부 같아야 하고, IDLE은 주문마다 건물 크기가 달라 바디 수·heap은 비교하지 않는다
    const pass = sameResources(rows[0]!, rows[1]!) && same(rows[2]!, rows[3]!);
    console.log(`memory soak (${count} orders): ${pass ? 'PASS' : 'FAIL'}`);
    this.lastSoak = snaps;
    this.lastPass = pass;
    return pass;
  }

  /** 상태에 들어갈 때까지 (이미 그 상태면 바로) */
  private until(state: GameState): Promise<void> {
    const fsm = this.game.fsm;
    if (fsm.is(state)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        queueMicrotask(off);
        reject(new Error(`timed out waiting for ${state} (now ${fsm.state})`));
      }, STATE_TIMEOUT_MS);
      const off = fsm.onEnter(state, () => {
        clearTimeout(timer);
        queueMicrotask(off); // 리스너 목록을 도는 중에 지우지 않게
        resolve();
      });
    });
  }

  addGui(gui: GUI): void {
    const folder = gui.addFolder('Memory (dev)');
    folder.close();
    folder.add(this.last, 'heapMB').name('JS heap MB').disable().listen();
    folder.add(this.last, 'geometries').name('Geometries').disable().listen();
    folder.add(this.last, 'textures').name('Textures').disable().listen();
    folder.add(this.last, 'bodies').name('Rapier bodies').disable().listen();
    folder.add(this.last, 'colliders').name('Rapier colliders').disable().listen();
    folder.add({ snap: () => console.table([this.snapshot('manual')]) }, 'snap').name('Snapshot');
    folder.add({ soak: () => void this.soak(10) }, 'soak').name('Soak 10 orders');
  }
}

/** 건물 크기와 무관한 GPU 자원(지오메트리·텍스처)과 라이트가 같은지 (건물이 서 있는 IDLE 비교용) */
function sameResources(a: MemorySnapshot, b: MemorySnapshot): boolean {
  return a.geometries === b.geometries && a.textures === b.textures && a.lights === b.lights;
}

/** 빈 부지(게시판)에서 첫 건물 뒤(a)와 마지막 건물 뒤(b)가 같은 수준인지: 자원 수는 같고 heap은 허용 비율 안 */
function same(a: MemorySnapshot, b: MemorySnapshot): boolean {
  return (
    a.geometries === b.geometries &&
    a.textures === b.textures &&
    a.rapierBodies === b.rapierBodies &&
    a.rapierColliders === b.rapierColliders &&
    a.lights === b.lights &&
    (Number.isNaN(a.heapMB) || b.heapMB <= a.heapMB * (1 + HEAP_TOLERANCE))
  );
}

/** 지금부터 rAF 프레임을 센다. stop(): 평균 FPS */
function countFrames(): { stop: () => number } {
  const start = performance.now();
  let frames = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
      const sec = (performance.now() - start) / 1000;
      return sec > 0 ? Math.round((frames / sec) * 10) / 10 : 0;
    },
  };
}

/** 스냅샷 전: 렌더 목록 등이 이전 건물을 놓을 만큼 몇 프레임 돌리고, gc가 있으면 두 번 */
async function settle(): Promise<void> {
  const gc = (window as { gc?: () => void }).gc;
  await nextFrames(SETTLE_FRAMES);
  gc?.();
  await nextFrames(SETTLE_FRAMES);
}

function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1));
    tick(n);
  });
}

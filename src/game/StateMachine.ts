// 게임 상태 머신 (상태 변경은 여기서만, 선택된 발사대도 여기서 같이 바꾼다)
// CLAUDE.md 다이어그램:
//   IDLE ─[대포/마법사]→ CUTSCENE ─(비행 끝/스킵)→ AIMING ─[발사]→ PROJECTILE_CAM
//   PROJECTILE_CAM ─(충돌)→ IMPACT ─(hit-stop 끝)→ SPECTATE   (빗나가면 PROJECTILE_CAM → SPECTATE)
//   SPECTATE ─[대포/마법사]→ CUTSCENE,  SPECTATE ─[리셋/뒤로]→ IDLE
import type { LauncherId } from './Launcher';

export const GameState = {
  IDLE: 'IDLE',
  CUTSCENE: 'CUTSCENE',
  AIMING: 'AIMING',
  PROJECTILE_CAM: 'PROJECTILE_CAM',
  IMPACT: 'IMPACT',
  SPECTATE: 'SPECTATE',
} as const;
export type GameState = (typeof GameState)[keyof typeof GameState];

const { IDLE, CUTSCENE, AIMING, PROJECTILE_CAM, IMPACT, SPECTATE } = GameState;

/** 허용 전이 표 */
export const TRANSITIONS: Readonly<Record<GameState, readonly GameState[]>> = {
  [IDLE]: [CUTSCENE],
  [CUTSCENE]: [AIMING],
  [AIMING]: [PROJECTILE_CAM],
  [PROJECTILE_CAM]: [IMPACT, SPECTATE],
  [IMPACT]: [SPECTATE],
  [SPECTATE]: [CUTSCENE, IDLE],
};

export type StateListener = (from: GameState, to: GameState) => void;

export class StateMachine {
  private current: GameState;
  private selected: LauncherId = 'cannon';
  private readonly enter = new Map<GameState, StateListener[]>();
  private readonly exit = new Map<GameState, StateListener[]>();
  private readonly change: StateListener[] = [];

  constructor(initial: GameState = IDLE) {
    this.current = initial;
  }

  get state(): GameState {
    return this.current;
  }

  /** 지금(또는 마지막으로) 선택된 발사대. CUTSCENE으로 들어갈 때 바뀐다 */
  get launcher(): LauncherId {
    return this.selected;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }

  can(to: GameState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /**
   * to로 전이. 허용되지 않으면 경고만 하고 false.
   * 순서: from의 onExit → 상태(·발사대) 변경 → to의 onEnter → onChange
   * CUTSCENE으로 갈 때는 launcher로 발사대를 고른다 (생략하면 이전 선택 유지).
   */
  transition(to: GameState, launcher?: LauncherId): boolean {
    const from = this.current;
    if (!this.can(to)) {
      console.warn(`StateMachine: ${from} → ${to} 는 허용되지 않은 전이`);
      return false;
    }
    for (const fn of this.exit.get(from) ?? []) fn(from, to);
    this.current = to;
    if (to === CUTSCENE && launcher) this.selected = launcher;
    for (const fn of this.enter.get(to) ?? []) fn(from, to);
    for (const fn of this.change) fn(from, to);
    return true;
  }

  onEnter(state: GameState, fn: StateListener): () => void {
    return subscribe(this.enter, state, fn);
  }

  onExit(state: GameState, fn: StateListener): () => void {
    return subscribe(this.exit, state, fn);
  }

  onChange(fn: StateListener): () => void {
    this.change.push(fn);
    return () => remove(this.change, fn);
  }
}

function subscribe(
  map: Map<GameState, StateListener[]>,
  state: GameState,
  fn: StateListener,
): () => void {
  const list = map.get(state) ?? [];
  list.push(fn);
  map.set(state, list);
  return () => remove(list, fn);
}

function remove(list: StateListener[], fn: StateListener): void {
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
}

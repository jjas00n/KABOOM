// HUD: 대포 버튼, 파워 게이지, 리셋, 크로스헤어, 상태별 안내 (스타일은 index.html의 .hud)
import { GameState } from '../game/StateMachine';

const HINTS: Record<GameState, string> = {
  [GameState.IDLE]: 'Drag: look around',
  [GameState.CANNON_CUTSCENE]: 'Click / Space: skip',
  [GameState.AIMING]: 'Drag / WASD: aim · Wheel / Q E: power · Space / Click: FIRE',
  [GameState.PROJECTILE_CAM]: '',
  [GameState.IMPACT]: '',
  [GameState.SPECTATE]: 'Drag: look around · C: cannon · R: reset',
};

export class HUD {
  private readonly root = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly crosshair = document.createElement('div');
  private readonly power = document.createElement('div');
  private readonly powerFill = document.createElement('div');
  private readonly powerLabel = document.createElement('div');
  private readonly cannonButton = document.createElement('button');
  private readonly resetButton = document.createElement('button');

  constructor(onCannon: () => void, onReset: () => void) {
    this.root.className = 'hud';
    this.hint.className = 'hud-hint';
    this.crosshair.className = 'hud-crosshair';
    this.power.className = 'hud-power';
    this.powerFill.className = 'hud-power-fill';
    this.powerLabel.className = 'hud-power-label';
    const bar = document.createElement('div');
    bar.className = 'hud-power-bar';
    bar.append(this.powerFill);
    this.power.append(this.powerLabel, bar);

    const buttons = document.createElement('div');
    buttons.className = 'hud-buttons';
    this.cannonButton.textContent = 'Cannon';
    this.cannonButton.className = 'hud-button hud-button-primary';
    this.resetButton.textContent = 'Reset';
    this.resetButton.className = 'hud-button';
    // 버튼 클릭이 캔버스 클릭(발사·스킵)으로 새지 않게
    for (const [button, action] of [
      [this.cannonButton, onCannon],
      [this.resetButton, onReset],
    ] as const) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        button.blur(); // Space가 버튼을 다시 누르지 않게
        action();
      });
    }
    buttons.append(this.cannonButton, this.resetButton);

    this.root.append(this.crosshair, this.power, this.hint, buttons);
    document.body.append(this.root);
  }

  /** 상태에 맞게 보이고 숨긴다. ready = 건물 준비 끝 (대포 버튼 활성화) */
  setState(state: GameState, ready: boolean): void {
    const aiming = state === GameState.AIMING;
    this.crosshair.hidden = !aiming;
    this.power.hidden = !aiming;
    this.hint.textContent = HINTS[state];
    this.hint.hidden = HINTS[state] === '';
    this.cannonButton.hidden = !(state === GameState.IDLE || state === GameState.SPECTATE);
    this.cannonButton.disabled = !ready;
    this.resetButton.hidden = state !== GameState.SPECTATE;
  }

  /** power: 0~1, speed: m/s */
  setPower(power: number, speed: number): void {
    this.powerFill.style.width = `${Math.round(power * 100)}%`;
    this.powerLabel.textContent = `Power ${Math.round(power * 100)}% · ${Math.round(speed)} m/s`;
  }
}

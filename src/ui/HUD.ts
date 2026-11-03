// HUD: 대포·마법사 버튼, 파워 게이지, 뒤로, 의뢰 포기, 크로스헤어, 상태별 안내 (스타일은 index.html의 .hud)
// 건물 재생성(Reset)은 디버그 GUI에만 있다 (같은 의뢰를 다시 부숴 파편 수익을 반복하지 않게).
import { ORDERS } from '../config';
import type { LauncherId } from '../game/Launcher';
import { GameState } from '../game/StateMachine';

const HINTS: Record<GameState, string> = {
  [GameState.ORDER_BOARD]: '',
  [GameState.LOADING]: '',
  [GameState.IDLE]: 'Drag: look around · C: cannon · F: wizard',
  [GameState.CUTSCENE]: 'Click / Space: skip',
  [GameState.AIMING]: 'Drag / WASD: aim · Wheel / Q E: power · Space / Click: FIRE',
  [GameState.PROJECTILE_CAM]: '',
  [GameState.IMPACT]: '',
  [GameState.SPECTATE]: 'Drag: look around · C: cannon · F: wizard · Esc: back',
  [GameState.FINALE]: 'Click / Space: skip',
  [GameState.RESULT]: '',
};

export class HUD {
  private readonly root = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly crosshair = document.createElement('div');
  private readonly power = document.createElement('div');
  private readonly powerFill = document.createElement('div');
  private readonly powerLabel = document.createElement('div');
  private readonly cannonButton = document.createElement('button');
  private readonly wizardButton = document.createElement('button');
  private readonly abandonButton = document.createElement('button');
  private readonly backButton = document.createElement('button');
  /** 의뢰 포기 확인 대기 타이머 (한 번 누르면 확인 상태, 시간 안에 다시 누르면 포기) */
  private abandonTimer: ReturnType<typeof setTimeout> | null = null;

  /** onBack: 부서진 건물 그대로 처음 화면(IDLE)으로, onAbandon: 의뢰 포기 (두 번 눌러 확인한 뒤) */
  constructor(onLauncher: (id: LauncherId) => void, onBack: () => void, onAbandon: () => void) {
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
    this.wizardButton.textContent = 'Wizard';
    this.wizardButton.className = 'hud-button hud-button-primary hud-button-fire';
    this.abandonButton.className = 'hud-button hud-button-abandon';
    this.resetAbandon();
    this.backButton.textContent = 'Back';
    this.backButton.className = 'hud-button';
    // 버튼 클릭이 캔버스 클릭(발사·스킵)으로 새지 않게
    for (const [button, action] of [
      [this.cannonButton, () => onLauncher('cannon')],
      [this.wizardButton, () => onLauncher('wizard')],
      [this.backButton, onBack],
      [this.abandonButton, () => this.confirmAbandon(onAbandon)],
    ] as const) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        button.blur(); // Space가 버튼을 다시 누르지 않게
        action();
      });
    }
    buttons.append(this.cannonButton, this.wizardButton, this.backButton, this.abandonButton);

    this.root.append(this.crosshair, this.power, this.hint, buttons);
    document.body.append(this.root);
  }

  /** 상태에 맞게 보이고 숨긴다 */
  setState(state: GameState): void {
    const aiming = state === GameState.AIMING;
    this.crosshair.hidden = !aiming;
    this.power.hidden = !aiming;
    this.hint.textContent = HINTS[state];
    this.hint.hidden = HINTS[state] === '';
    const pickable = state === GameState.IDLE || state === GameState.SPECTATE;
    for (const button of [this.cannonButton, this.wizardButton]) button.hidden = !pickable;
    this.backButton.hidden = state !== GameState.SPECTATE;
    this.abandonButton.hidden = !pickable;
    if (!pickable) this.resetAbandon();
  }

  private confirmAbandon(onAbandon: () => void): void {
    if (this.abandonTimer !== null) {
      this.resetAbandon();
      onAbandon();
      return;
    }
    this.abandonButton.textContent = 'Click again to abandon';
    this.abandonButton.classList.add('confirm');
    this.abandonTimer = setTimeout(() => this.resetAbandon(), ORDERS.abandonConfirmSec * 1000);
  }

  private resetAbandon(): void {
    if (this.abandonTimer !== null) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
    this.abandonButton.textContent = 'Abandon order';
    this.abandonButton.classList.remove('confirm');
  }

  /** power: 0~1, speed: m/s */
  setPower(power: number, speed: number): void {
    this.powerFill.style.width = `${Math.round(power * 100)}%`;
    this.powerLabel.textContent = `Power ${Math.round(power * 100)}% · ${Math.round(speed)} m/s`;
  }
}

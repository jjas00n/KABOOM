// 보간 곡선과 프레임 독립 스무딩 (카메라·연출 공용, 순수 함수)

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 천천히 출발해 천천히 도착 */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** 목표를 살짝 넘었다가 돌아오며 멈춤 (대포가 솟아오를 때) */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

/**
 * 지수 스무딩 계수: current += (target - current) × smoothing(dt, tau).
 * tau(시간상수)초 뒤에 남은 거리의 1/e. 프레임레이트와 무관하다.
 */
export function smoothing(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

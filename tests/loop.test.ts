import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/core/Loop';

const STEP = 1 / 60;

describe('FixedStepper', () => {
  it('runs one step per fixed timestep', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    expect(s.advance(STEP)).toBe(1);
    expect(s.alpha).toBeCloseTo(0);
  });

  it('accumulates partial steps and exposes alpha', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    expect(s.advance(STEP / 2)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5);
    expect(s.advance(STEP / 2)).toBe(1);
    expect(s.alpha).toBeCloseTo(0);
  });

  it('does not drift over many frames', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    let total = 0;
    for (let i = 0; i < 600; i++) total += s.advance(STEP);
    expect(total).toBe(600);
  });

  it('clamps to maxSubSteps and drops the backlog', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    expect(s.advance(0.2)).toBe(5);
    expect(s.alpha).toBe(0);
  });

  it('clamps huge frame times to maxFrameDt', () => {
    const s = new FixedStepper(STEP, 100, 0.25);
    expect(s.advance(10)).toBe(15); // 0.25s / (1/60)
  });

  it('slows down with timeScale', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    s.timeScale = 0.2;
    let total = 0;
    for (let i = 0; i < 100; i++) total += s.advance(STEP);
    expect(total).toBe(20);
  });

  it('freezes at timeScale 0', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    s.timeScale = 0;
    expect(s.advance(1)).toBe(0);
    expect(s.alpha).toBe(0);
  });
});

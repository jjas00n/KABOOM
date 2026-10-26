import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, DEBRIS, PHYSICS, QUALITY_PRESETS } from '../src/config';

describe('config', () => {
  it('quality presets increase in fragment count', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(low.targetFragments).toBeLessThan(medium.targetFragments);
    expect(medium.targetFragments).toBeLessThan(high.targetFragments);
  });

  it('default quality is a valid preset', () => {
    expect(QUALITY_PRESETS[DEFAULT_QUALITY]).toBeDefined();
  });

  it('physics runs at 60Hz', () => {
    expect(PHYSICS.fixedTimestep).toBeCloseTo(1 / 60);
  });

  it('dynamic fragment cap is positive', () => {
    expect(DEBRIS.maxDynamicFragments).toBeGreaterThan(0);
  });
});

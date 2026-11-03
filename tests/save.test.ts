import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE } from '../src/config';
import { migrate } from '../src/save/migrations';
import { defaultSave, SAVE_VERSION, type SaveData } from '../src/save/SaveData';
import { SaveStore, type SaveStorage } from '../src/save/SaveStore';

class MemoryStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const throwing: SaveStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

function sample(): SaveData {
  return {
    version: SAVE_VERSION,
    wallet: { money: 1234.5, lifetimeEarned: 5000 },
    career: {
      buildingsDemolished: 3,
      ordersAbandoned: 1,
      totalFragments: 9876,
      best: { name: 'Riverside Tower', total: 2100 },
      starterComplete: false,
    },
    boardSeed: 17,
    settings: { quality: 'high' },
  };
}

describe('SaveStore', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('round-trips a save', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    expect(store.save(sample())).toBe(true);
    expect(store.load()).toEqual(sample());
    expect(storage.map.has(SAVE.key)).toBe(true);
    store.clear();
    expect(store.load()).toEqual(defaultSave());
  });

  it('starts a new game when the save is empty, corrupt or from an unknown version', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    expect(store.load()).toEqual(defaultSave());
    for (const bad of ['{not json', 'null', '42', '[]', '"text"', '{}', '{"version":"1"}']) {
      storage.setItem(SAVE.key, bad);
      expect(store.load()).toEqual(defaultSave());
    }
    storage.setItem(SAVE.key, JSON.stringify({ ...sample(), version: SAVE_VERSION + 1 }));
    expect(store.load()).toEqual(defaultSave());
  });

  it('never throws when storage is blocked or full', () => {
    const store = new SaveStore(throwing);
    expect(store.load()).toEqual(defaultSave());
    expect(store.save(sample())).toBe(false);
    expect(() => store.clear()).not.toThrow();
    const none = new SaveStore(null);
    expect(none.load()).toEqual(defaultSave());
    expect(none.save(sample())).toBe(false);
  });

  it('repairs bad fields one by one and keeps the good ones', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    storage.setItem(
      SAVE.key,
      JSON.stringify({
        version: SAVE_VERSION,
        wallet: { money: -5, lifetimeEarned: 'lots' },
        career: { buildingsDemolished: 2.7, totalFragments: null, best: { name: 3 } },
        boardSeed: 1.5,
        settings: { quality: 'ultra' },
      }),
    );
    const d = defaultSave();
    expect(store.load()).toEqual({
      ...d,
      career: { ...d.career, buildingsDemolished: 2 },
    });
    // NaN / Infinity는 JSON에서 null이 되지만 직접 넣은 값도 막는다
    storage.setItem(
      SAVE.key,
      `{"version":${SAVE_VERSION},"wallet":{"money":1e999,"lifetimeEarned":10},"boardSeed":9}`,
    );
    const loaded = store.load();
    expect(loaded.wallet).toEqual({ money: 0, lifetimeEarned: 10 });
    expect(loaded.boardSeed).toBe(9);
  });

  it('migrates an older save to the current version', () => {
    const v0 = { version: 0, money: 300, boardSeed: 4 };
    const migrated = migrate(v0);
    expect(migrated?.version).toBe(SAVE_VERSION);
    const storage = new MemoryStorage();
    storage.setItem(SAVE.key, JSON.stringify(v0));
    const loaded = new SaveStore(storage).load();
    expect(loaded.wallet).toEqual({ money: 300, lifetimeEarned: 300 });
    expect(loaded.boardSeed).toBe(4);
    // v0 → v1 → v2: 7-4 이전 세이브는 입문 단계를 건너뛴다
    expect(loaded.career).toEqual({ ...defaultSave().career, starterComplete: true });
    expect(migrate({ version: -1 })).toBeNull();
  });

  it('v1 → v2: keeps wallet, career and board, and skips the starter tier', () => {
    const v1 = {
      version: 1,
      wallet: { money: 800, lifetimeEarned: 2500 },
      career: { buildingsDemolished: 1, ordersAbandoned: 2, totalFragments: 4000, best: null },
      boardSeed: 12,
      settings: { quality: 'low' },
    };
    const storage = new MemoryStorage();
    storage.setItem(SAVE.key, JSON.stringify(v1));
    const loaded = new SaveStore(storage).load();
    expect(loaded.version).toBe(2);
    expect(loaded.wallet).toEqual(v1.wallet);
    expect(loaded.career).toEqual({ ...v1.career, starterComplete: true });
    expect(loaded.boardSeed).toBe(12);
    expect(loaded.settings.quality).toBe('low');
    // 새 게임은 입문 단계부터
    expect(defaultSave().career.starterComplete).toBe(false);
  });

  it('a future version starts a new game', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE.key, JSON.stringify({ ...sample(), version: SAVE_VERSION + 1 }));
    expect(new SaveStore(storage).load()).toEqual(defaultSave());
  });
});

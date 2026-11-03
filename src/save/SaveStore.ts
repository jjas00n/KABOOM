// localStorage 저장/로드. 어떤 실패(저장소 없음·용량 초과·깨진 JSON·모르는 버전·이상한 값)에도
// 예외를 밖으로 내지 않고, 로드는 새 게임 기본값으로 정상 시작한다.
import { QUALITY_PRESETS, SAVE, type QualityPreset } from '../config';
import type { CareerData } from '../orders/Career';
import { isRecord, migrate } from './migrations';
import { defaultSave, SAVE_VERSION, type SaveData } from './SaveData';

/** localStorage 중 쓰는 부분 (테스트는 메모리 구현) */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class SaveStore {
  /** storage: null이면 저장 안 함 (접근 자체가 막힌 환경) */
  constructor(
    private readonly storage: SaveStorage | null,
    private readonly key: string = SAVE.key,
  ) {}

  /** 저장된 게임 (없거나 못 읽으면 새 게임) */
  load(): SaveData {
    let text: string | null;
    try {
      text = this.storage?.getItem(this.key) ?? null;
    } catch (err) {
      console.warn('save: cannot read storage, starting a new game', err);
      return defaultSave();
    }
    if (text === null) return defaultSave();
    try {
      const data = migrate(JSON.parse(text));
      if (data) return sanitize(data);
      console.warn('save: unknown save version, starting a new game');
    } catch (err) {
      console.warn('save: corrupt save, starting a new game', err);
    }
    return defaultSave();
  }

  /** 반환: 저장됐는지 */
  save(data: SaveData): boolean {
    try {
      this.storage?.setItem(this.key, JSON.stringify(data));
      return this.storage !== null;
    } catch (err) {
      console.warn('save: cannot write storage', err);
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch (err) {
      console.warn('save: cannot clear storage', err);
    }
  }
}

/** 지금 버전 모양의 값을 필드별로 검증. 틀린 필드만 기본값으로 */
export function sanitize(raw: Record<string, unknown>): SaveData {
  const d = defaultSave();
  const wallet = isRecord(raw.wallet) ? raw.wallet : {};
  const money = amount(wallet.money, d.wallet.money);
  const career = isRecord(raw.career) ? raw.career : {};
  const settings = isRecord(raw.settings) ? raw.settings : {};
  return {
    version: SAVE_VERSION,
    wallet: { money, lifetimeEarned: Math.max(amount(wallet.lifetimeEarned, money), money) },
    career: {
      buildingsDemolished: count(career.buildingsDemolished),
      ordersAbandoned: count(career.ordersAbandoned),
      totalFragments: count(career.totalFragments),
      best: best(career.best),
      starterComplete: career.starterComplete === true,
    },
    boardSeed: seed(raw.boardSeed, d.boardSeed),
    settings: { quality: quality(settings.quality, d.settings.quality) },
  };
}

function amount(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function seed(v: unknown, fallback: number): number {
  return Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : fallback;
}

function quality(v: unknown, fallback: QualityPreset): QualityPreset {
  return typeof v === 'string' && Object.hasOwn(QUALITY_PRESETS, v)
    ? (v as QualityPreset)
    : fallback;
}

function best(v: unknown): CareerData['best'] {
  if (!isRecord(v) || typeof v.name !== 'string') return null;
  const total = amount(v.total, -1);
  return total >= 0 ? { name: v.name, total } : null;
}

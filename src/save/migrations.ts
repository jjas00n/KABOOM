// 세이브 마이그레이션: 버전 n → n+1 함수를 차례로 적용해 지금 버전으로 올린다.
// 모르는(더 새로운) 버전이나 버전 없는 값은 null → 호출 쪽이 새 게임으로 시작한다.
// 마이그레이션은 모양만 맞추고, 값 검증·정리는 SaveStore.sanitize가 한다.
import { SAVE_VERSION } from './SaveData';

type Raw = Record<string, unknown>;

/**
 * from 버전 → from + 1 버전.
 * v0: 7-3 개발 중 임시 포맷 { version: 0, money, boardSeed } (실제 배포된 적은 없다. 체인 자리 + 테스트용)
 * v1 → v2 (7-4 입문 건물): 이미 하던 플레이어는 입문 단계를 건너뛴다 (career.starterComplete = true → office 주문)
 */
export const MIGRATIONS: Readonly<Record<number, (raw: Raw) => Raw>> = {
  0: (raw) => ({
    version: 1,
    wallet: { money: raw.money, lifetimeEarned: raw.money },
    boardSeed: raw.boardSeed,
  }),
  1: (raw) => ({
    ...raw,
    version: 2,
    career: { ...(isRecord(raw.career) ? raw.career : {}), starterComplete: true },
  }),
};

export function migrate(raw: unknown): Raw | null {
  if (!isRecord(raw) || typeof raw.version !== 'number') return null;
  let data: Raw = raw;
  while ((data.version as number) < SAVE_VERSION) {
    const step = MIGRATIONS[data.version as number];
    if (!step) return null;
    data = step(data);
  }
  return data.version === SAVE_VERSION ? data : null;
}

export function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

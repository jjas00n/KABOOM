// 저장 스키마 (버전 있음). 바꿀 때는 SAVE_VERSION을 올리고 migrations.ts에 이전 버전 → 새 버전 함수를 더한다.
import { DEFAULT_QUALITY, SAVE, type QualityPreset } from '../config';
import { emptyCareer, type CareerData } from '../orders/Career';

export const SAVE_VERSION = 2;

export interface SaveSettings {
  quality: QualityPreset;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  wallet: { money: number; lifetimeEarned: number };
  career: CareerData;
  /** 지금 게시판의 seed (의뢰를 받으면 바로 다음 seed로 넘어간다) */
  boardSeed: number;
  settings: SaveSettings;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    wallet: { money: 0, lifetimeEarned: 0 },
    career: emptyCareer(),
    boardSeed: SAVE.firstBoardSeed,
    settings: { quality: DEFAULT_QUALITY },
  };
}

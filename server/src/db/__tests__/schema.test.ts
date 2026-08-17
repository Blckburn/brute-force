import { DIFFICULTIES, ZONE_IDS } from '@bruteforce/shared';
import { describe, expect, it } from 'vitest';

import { difficultyEnum, zoneEnum } from '../schema/enums.ts';
import * as schema from '../schema/index.ts';

/**
 * Перечисления существуют в двух местах: в @bruteforce/shared (контракт
 * с клиентом) и в схеме БД. Дублирование вынужденное — тянуть схему БД
 * в браузерный пакет нельзя. Значит нужен тест, который ловит расхождение:
 * иначе однажды в GDD добавят зону, её пропишут в одном месте, и запрос
 * начнёт падать на вставке.
 */
describe('схема БД', () => {
  it('зоны совпадают с контрактом', () => {
    expect([...zoneEnum.enumValues].sort()).toEqual([...ZONE_IDS].sort());
  });

  it('тиры сложности совпадают с контрактом', () => {
    expect([...difficultyEnum.enumValues].sort()).toEqual([...DIFFICULTIES].sort());
  });

  it('присутствуют все таблицы из GDD §2.3', () => {
    const required = [
      'players',
      'playerTraits',
      'items',
      'equipment',
      'runs',
      'battles',
      'dailies',
      'arenaLadder',
    ] as const;

    for (const table of required) {
      expect(schema, table).toHaveProperty(table);
    }
  });

  it('присутствуют таблицы авторизации', () => {
    for (const table of ['user', 'session', 'account', 'verification'] as const) {
      expect(schema, table).toHaveProperty(table);
    }
  });
});

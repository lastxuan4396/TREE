import test from 'node:test';
import assert from 'node:assert/strict';

import { awardXp, syncUnlockState, updateStreak } from '../scripts/core.js';

test('awardXp should level up and carry remaining xp', () => {
  const result = awardXp({ level: 1, xp: 130 }, 20);
  assert.equal(result.level, 2);
  assert.equal(result.xp, 10);
  assert.equal(result.levelUps, 1);
});

test('syncUnlockState should unlock child when parent reaches Lv2', () => {
  const nodes = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
  ];

  const locked = syncUnlockState(nodes, {
    root: { level: 1, xp: 0, unlocked: true },
    child: { level: 1, xp: 0, unlocked: false },
  });
  assert.equal(locked.child.unlocked, false);

  const unlocked = syncUnlockState(nodes, {
    root: { level: 2, xp: 0, unlocked: true },
    child: { level: 1, xp: 0, unlocked: false },
  });
  assert.equal(unlocked.child.unlocked, true);
});

test('updateStreak should grant bonus on 7th day and reset after gap', () => {
  const day7 = updateStreak('2026-03-07', 6, '2026-03-08');
  assert.equal(day7.streak, 7);
  assert.equal(day7.bonus, 80);

  const reset = updateStreak('2026-03-05', 7, '2026-03-08');
  assert.equal(reset.streak, 1);
  assert.equal(reset.bonus, 0);
});

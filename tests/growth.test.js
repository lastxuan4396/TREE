import test from 'node:test';
import assert from 'node:assert/strict';

import { difficultyMap } from '../scripts/modules/constants.js';
import { computeAdaptiveXp, computeWeeklyChallengeProgress, ensureWeeklyChallenge, getDailyTaskRecommendation } from '../scripts/modules/growth.js';
import { createInitialState } from '../scripts/modules/state.js';

test('computeAdaptiveXp should give recovery bonus after long gap', () => {
  const state = createInitialState();
  state.taskLogs = [
    {
      kind: 'task',
      date: '2026-03-01',
      taskId: 'spark-1',
      nodeId: 'spark',
      xp: 10,
      difficulty: 'easy',
    },
  ];

  const task = state.tasks.find((item) => item.id === 'spark-1');
  const result = computeAdaptiveXp(task, state, difficultyMap, '2026-03-09');

  assert.equal(result.baseXp, 10);
  assert.ok(result.bonusXp > 0);
  assert.ok(result.totalXp > result.baseXp);
});

test('computeWeeklyChallengeProgress should update progress and claimable state', () => {
  const state = createInitialState();
  state.growth.weeklyChallenge = {
    type: 'consistency',
    title: '周挑战',
    description: '测试',
    weekKey: '2026-03-09',
    target: 2,
    rewardXp: 120,
    progress: 0,
    claimed: false,
    createdAt: '2026-03-09T00:00:00.000Z',
  };

  state.taskLogs = [
    { kind: 'task', date: '2026-03-09', taskId: 'spark-1', nodeId: 'spark', xp: 10, difficulty: 'easy' },
    { kind: 'task', date: '2026-03-10', taskId: 'break-1', nodeId: 'breakdown', xp: 10, difficulty: 'easy' },
  ];

  const progress = computeWeeklyChallengeProgress(state, '2026-03-12');
  assert.equal(progress.progress, 2);
  assert.equal(progress.completed, true);
  assert.equal(progress.claimable, true);
});

test('getDailyTaskRecommendation should prioritize low-resistance tasks after interruption gap', () => {
  const state = createInitialState();
  state.taskLogs = [
    {
      kind: 'task',
      date: '2026-03-01',
      taskId: 'spark-3',
      nodeId: 'spark',
      xp: 20,
      difficulty: 'medium',
    },
  ];
  state.reflections = [{ id: 'r1', date: '2026-03-08', text: '今天一直拖延，躲着做事。' }];

  const challenge = ensureWeeklyChallenge(state, '2026-03-09');
  assert.ok(challenge.target > 0);

  const recommendation = getDailyTaskRecommendation(state, difficultyMap, 5, '2026-03-09');
  assert.equal(Boolean(recommendation.task), true);
  assert.equal(recommendation.doneToday, false);
  assert.equal(recommendation.task.difficulty, 'easy');
});

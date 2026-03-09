import { addDays, dateDistance, getDateKey, getXpCap } from '../core.js';
import { getWeekStart, nodeCompletionInDays } from './analytics.js';

function getTaskLogsInCurrentWeek(taskLogs, today = getDateKey()) {
  const weekStart = getWeekStart(today);
  return taskLogs.filter((log) => log.kind === 'task' && dateDistance(weekStart, log.date) >= 0 && dateDistance(log.date, today) >= 0);
}

function getTaskLogsInPreviousWeek(taskLogs, today = getDateKey()) {
  const currentWeekStart = getWeekStart(today);
  const prevWeekStart = addDays(currentWeekStart, -7);
  const prevWeekEnd = addDays(currentWeekStart, -1);
  return taskLogs.filter(
    (log) => log.kind === 'task' && dateDistance(prevWeekStart, log.date) >= 0 && dateDistance(log.date, prevWeekEnd) >= 0,
  );
}

export function getRecoveryGapDays(taskLogs, today = getDateKey()) {
  const latest = taskLogs.find((log) => log.kind === 'task');
  if (!latest) return 0;
  const diff = dateDistance(latest.date, today);
  if (diff <= 1) return 0;
  return diff - 1;
}

function selectChallengeTemplate(state, today = getDateKey()) {
  const previousWeekTasks = getTaskLogsInPreviousWeek(state.taskLogs, today);
  const uniqueNodes = new Set(previousWeekTasks.map((log) => log.nodeId)).size;
  const mediumHardCount = previousWeekTasks.filter((log) => (log.difficulty ? log.difficulty !== 'easy' : Number(log.xp || 0) >= 20)).length;

  if (uniqueNodes < 3) {
    return {
      type: 'variety',
      title: '周挑战：扩展能力面',
      description: '本周覆盖 3 个不同节点。',
      target: 3,
      rewardXp: 150,
    };
  }

  if (mediumHardCount < 4) {
    return {
      type: 'depth',
      title: '周挑战：强度提升',
      description: '本周完成 4 个中等/困难任务。',
      target: 4,
      rewardXp: 170,
    };
  }

  return {
    type: 'consistency',
    title: '周挑战：稳定输出',
    description: '本周完成 6 个任务。',
    target: 6,
    rewardXp: 130,
  };
}

export function ensureWeeklyChallenge(state, today = getDateKey()) {
  if (!state.growth || typeof state.growth !== 'object') {
    state.growth = {
      weeklyChallenge: null,
      lastRecoveryAt: '',
    };
  }

  const weekKey = getWeekStart(today);
  const current = state.growth.weeklyChallenge;
  if (current && current.weekKey === weekKey) {
    return current;
  }

  const template = selectChallengeTemplate(state, today);
  const challenge = {
    ...template,
    weekKey,
    progress: 0,
    claimed: false,
    createdAt: new Date().toISOString(),
  };

  state.growth.weeklyChallenge = challenge;
  return challenge;
}

export function computeWeeklyChallengeProgress(state, today = getDateKey()) {
  const challenge = ensureWeeklyChallenge(state, today);
  const weekTasks = getTaskLogsInCurrentWeek(state.taskLogs, today);

  let progress = 0;
  if (challenge.type === 'variety') {
    progress = new Set(weekTasks.map((log) => log.nodeId)).size;
  } else if (challenge.type === 'depth') {
    progress = weekTasks.filter((log) => (log.difficulty ? log.difficulty !== 'easy' : Number(log.xp || 0) >= 20)).length;
  } else {
    progress = weekTasks.length;
  }

  challenge.progress = progress;
  return {
    ...challenge,
    progress,
    completed: progress >= challenge.target,
    claimable: progress >= challenge.target && !challenge.claimed,
  };
}

function contributesToChallenge(task, state, today = getDateKey()) {
  const challenge = computeWeeklyChallengeProgress(state, today);
  if (challenge.claimed) return false;

  if (challenge.type === 'variety') {
    const weekTasks = getTaskLogsInCurrentWeek(state.taskLogs, today);
    const currentNodes = new Set(weekTasks.map((log) => log.nodeId));
    return !currentNodes.has(task.nodeId);
  }

  if (challenge.type === 'depth') {
    return task.difficulty !== 'easy';
  }

  return true;
}

export function computeAdaptiveXp(task, state, difficultyMap, today = getDateKey()) {
  const baseXp = difficultyMap[task.difficulty]?.xp || 10;
  const gapDays = getRecoveryGapDays(state.taskLogs, today);
  const recent7TaskCount = state.taskLogs.filter((log) => log.kind === 'task' && dateDistance(log.date, today) >= 0 && dateDistance(log.date, today) < 7).length;

  let bonusXp = 0;
  const bonusReasons = [];

  if (gapDays >= 2) {
    const recoveryBonus = Math.min(24, gapDays * 4);
    bonusXp += recoveryBonus;
    bonusReasons.push(`恢复奖励 +${recoveryBonus}`);
  }

  if (recent7TaskCount <= 2 && task.difficulty === 'easy') {
    bonusXp += 6;
    bonusReasons.push('起步加成 +6');
  }

  if (recent7TaskCount >= 10 && task.difficulty === 'hard') {
    bonusXp += 10;
    bonusReasons.push('高强度加成 +10');
  }

  if (contributesToChallenge(task, state, today)) {
    bonusXp += 8;
    bonusReasons.push('挑战推进 +8');
  }

  bonusXp = Math.min(40, bonusXp);

  return {
    baseXp,
    bonusXp,
    totalXp: baseXp + bonusXp,
    bonusReasons,
  };
}

export function getDailyTaskRecommendation(state, difficultyMap, maxNodeLevel, today = getDateKey()) {
  const unlockedNodeIds = new Set(state.nodes.filter((node) => state.nodeProgress[node.id]?.unlocked).map((node) => node.id));

  const available = state.tasks.filter((task) => {
    if (!unlockedNodeIds.has(task.nodeId)) return false;
    return !state.taskLogs.some((log) => log.kind === 'task' && log.taskId === task.id && log.date === today);
  });

  if (!available.length) {
    const fallback = state.tasks.find((task) => unlockedNodeIds.has(task.nodeId));
    return { task: fallback || null, doneToday: true, reason: '今日任务已完成，建议写一句复盘。' };
  }

  const gapDays = getRecoveryGapDays(state.taskLogs, today);
  const interruptive = state.reflections
    .slice(0, 6)
    .some((item) => /拖延|打断|分心|焦虑|卡住|崩溃|躲着/.test(item.text));

  const node14 = nodeCompletionInDays(state.taskLogs, 14, today);
  const node7 = nodeCompletionInDays(state.taskLogs, 7, today);
  const challenge = computeWeeklyChallengeProgress(state, today);

  let chosen = available[0];
  let chosenReason = '保持节奏，推进当前能力节点。';
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const task of available) {
    const progress = state.nodeProgress[task.nodeId] || { level: 1, xp: 0 };
    const ratio = progress.level >= maxNodeLevel ? 1 : progress.xp / getXpCap(progress.level);

    const bottleneckScore = (1 - ratio) * 28;
    const lowMomentumScore = Math.max(0, 4 - (node7[task.nodeId] || 0)) * 6;
    const overFocusPenalty = (node14[task.nodeId] || 0) > 8 ? 8 : 0;

    const recoveryScore = gapDays >= 2 && task.difficulty === 'easy' ? 18 : 0;
    const interruptiveScore = interruptive && task.difficulty === 'easy' ? 10 : 0;

    let challengeScore = 0;
    if (!challenge.claimed) {
      if (challenge.type === 'variety') {
        const weekNodeSet = new Set(getTaskLogsInCurrentWeek(state.taskLogs, today).map((log) => log.nodeId));
        challengeScore = weekNodeSet.has(task.nodeId) ? 0 : 12;
      } else if (challenge.type === 'depth') {
        challengeScore = task.difficulty === 'easy' ? 0 : 12;
      } else {
        challengeScore = 8;
      }
    }

    const score = bottleneckScore + lowMomentumScore + recoveryScore + interruptiveScore + challengeScore - overFocusPenalty;

    if (score > bestScore) {
      bestScore = score;
      chosen = task;

      if (recoveryScore > 0) {
        chosenReason = `你刚经历了 ${gapDays} 天中断，先用低阻力任务恢复节奏。`;
      } else if (challengeScore >= 12) {
        chosenReason = '这个任务能直接推进你本周挑战进度。';
      } else if (lowMomentumScore >= 18) {
        chosenReason = '该节点近期推进偏慢，优先补上短板。';
      } else if (interruptiveScore > 0) {
        chosenReason = '最近复盘出现分心/拖延，先做低阻力任务更稳。';
      } else {
        chosenReason = '该节点当前进度最低，优先补齐短板。';
      }
    }
  }

  return {
    task: chosen,
    doneToday: false,
    reason: chosenReason,
  };
}

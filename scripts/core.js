export const MAX_NODE_LEVEL = 5;
export const UNLOCK_LEVEL = 2;
export const STREAK_BONUS_INTERVAL = 7;
export const STREAK_BONUS_XP = 80;
export const ANTI_CHEAT_DEFAULTS = {
  minTaskIntervalMs: 4000,
  maxTasksPerMinute: 6,
  maxTasksPerDay: 40,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function xpToNextLevel(level) {
  return 100 + level * 40;
}

export function getXpCap(level, maxLevel = MAX_NODE_LEVEL) {
  if (level >= maxLevel) {
    return xpToNextLevel(maxLevel - 1);
  }
  return xpToNextLevel(level);
}

export function awardXp(progress, amount, maxLevel = MAX_NODE_LEVEL) {
  let level = clampInt(progress.level, 1, maxLevel);
  let xp = clampInt(progress.xp, 0, getXpCap(level, maxLevel));
  let remaining = Math.max(0, Number(amount) || 0);
  let levelUps = 0;

  while (remaining > 0 && level < maxLevel) {
    const needed = xpToNextLevel(level) - xp;
    if (remaining >= needed) {
      remaining -= needed;
      level += 1;
      xp = 0;
      levelUps += 1;
    } else {
      xp += remaining;
      remaining = 0;
    }
  }

  if (level >= maxLevel) {
    xp = getXpCap(level, maxLevel);
  }

  return { level, xp, levelUps };
}

export function syncUnlockState(nodes, nodeProgress, unlockLevel = UNLOCK_LEVEL) {
  const next = {};

  for (const node of nodes) {
    const current = nodeProgress[node.id] || { level: 1, xp: 0, unlocked: false };
    next[node.id] = {
      level: clampInt(current.level, 1, MAX_NODE_LEVEL),
      xp: clampInt(current.xp, 0, getXpCap(clampInt(current.level, 1, MAX_NODE_LEVEL))),
      unlocked: Boolean(current.unlocked),
    };
  }

  for (const node of nodes) {
    if (!node.parentId) {
      next[node.id].unlocked = true;
      continue;
    }
    const parent = next[node.parentId];
    next[node.id].unlocked = Boolean(parent && parent.level >= unlockLevel);
  }

  return next;
}

export function updateStreak(lastCheckinDate, streak, today) {
  if (!today) {
    throw new Error('today is required');
  }

  if (lastCheckinDate === today) {
    return {
      streak,
      lastCheckinDate,
      bonus: 0,
      changed: false,
    };
  }

  let nextStreak = 1;
  if (lastCheckinDate) {
    const diff = dateDistance(lastCheckinDate, today);
    nextStreak = diff === 1 ? Math.max(0, streak) + 1 : 1;
  }

  const bonus = nextStreak > 0 && nextStreak % STREAK_BONUS_INTERVAL === 0 ? STREAK_BONUS_XP : 0;

  return {
    streak: nextStreak,
    lastCheckinDate: today,
    bonus,
    changed: true,
  };
}

export function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateDistance(fromKey, toKey) {
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey}T00:00:00`);
  return Math.round((to - from) / DAY_MS);
}

export function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getDateKey(date);
}

export function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function detectCompletionAnomaly(taskLogs, nowIso, todayDateKey, options = {}) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    return { blocked: true, reason: '时间戳无效' };
  }

  const config = {
    ...ANTI_CHEAT_DEFAULTS,
    ...options,
  };

  const tasks = Array.isArray(taskLogs) ? taskLogs.filter((log) => log && log.kind === 'task') : [];
  const todayTasks = tasks.filter((log) => log.date === todayDateKey);
  if (todayTasks.length >= config.maxTasksPerDay) {
    return { blocked: true, reason: `今日任务次数超过 ${config.maxTasksPerDay} 次` };
  }

  const recentTasks = tasks.filter((log) => {
    const ts = Date.parse(log.completedAt || `${log.date}T00:00:00`);
    return Number.isFinite(ts) && nowMs - ts <= 60 * 1000;
  });
  if (recentTasks.length >= config.maxTasksPerMinute) {
    return { blocked: true, reason: '1 分钟内任务过于频繁' };
  }

  if (tasks.length > 0) {
    const latestTs = Date.parse(tasks[0].completedAt || `${tasks[0].date}T00:00:00`);
    if (Number.isFinite(latestTs) && nowMs - latestTs < config.minTaskIntervalMs) {
      return { blocked: true, reason: '两次任务间隔过短' };
    }
  }

  return { blocked: false, reason: '' };
}

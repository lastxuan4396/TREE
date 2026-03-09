import { addDays, dateDistance, getDateKey } from '../core.js';

export function nodeCompletionInDays(taskLogs, days, today = getDateKey()) {
  const map = {};
  for (const log of taskLogs) {
    if (log.kind !== 'task') continue;
    const diff = dateDistance(log.date, today);
    if (diff < 0 || diff >= days) continue;
    map[log.nodeId] = (map[log.nodeId] || 0) + 1;
  }
  return map;
}

export function getWeekStart(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return getDateKey(date);
}

export function calculateRetention(visits, days, today = getDateKey()) {
  const unique = [...new Set(visits)].sort();
  if (!unique.length) return { eligible: 0, retained: 0, rate: 0 };

  const visitSet = new Set(unique);
  let eligible = 0;
  let retained = 0;

  for (const day of unique) {
    if (dateDistance(day, today) < days) continue;
    eligible += 1;
    if (visitSet.has(addDays(day, days))) retained += 1;
  }

  return {
    eligible,
    retained,
    rate: eligible === 0 ? 0 : Math.round((retained / eligible) * 100),
  };
}

export function computeWeeklyLayerMetrics(state, today = getDateKey()) {
  const weekStart = getWeekStart(today);
  const prevWeekStart = addDays(weekStart, -7);

  const firstVisit = state.meta.firstVisitDate;
  const newUsers = firstVisit && dateDistance(weekStart, firstVisit) >= 0 && dateDistance(firstVisit, today) >= 0 ? 1 : 0;

  const firstTaskDate = state.analytics.events
    .filter((e) => e.type === 'first_task_complete')
    .map((e) => e.date.slice(0, 10))
    .sort()[0];

  const activatedUsers = firstTaskDate && dateDistance(weekStart, firstTaskDate) >= 0 && dateDistance(firstTaskDate, today) >= 0 ? 1 : 0;

  const visits = [...new Set(state.meta.visits)].sort();
  const visitedThisWeek = visits.some((d) => dateDistance(weekStart, d) >= 0 && dateDistance(d, today) >= 0);
  const visitedPrevWeek = visits.some((d) => dateDistance(prevWeekStart, d) >= 0 && dateDistance(d, addDays(weekStart, -1)) >= 0);
  const retainedUsers = visitedThisWeek && visitedPrevWeek ? 1 : 0;

  let reactivatedUsers = 0;
  const firstThisWeekVisit = visits.find((d) => dateDistance(weekStart, d) >= 0 && dateDistance(d, today) >= 0);
  if (firstThisWeekVisit) {
    const previousVisit = [...visits].reverse().find((d) => dateDistance(d, firstThisWeekVisit) > 0);
    if (previousVisit && dateDistance(previousVisit, firstThisWeekVisit) >= 7) {
      reactivatedUsers = 1;
    }
  }

  return { newUsers, activatedUsers, retainedUsers, reactivatedUsers };
}

export function getWeeklySummary(state, today = getDateKey()) {
  const weekLogs = state.taskLogs.filter((log) => {
    const diff = dateDistance(log.date, today);
    return diff >= 0 && diff < 7;
  });

  const xpByNode = {};
  for (const node of state.nodes) xpByNode[node.id] = 0;
  for (const log of weekLogs) {
    xpByNode[log.nodeId] = (xpByNode[log.nodeId] || 0) + Number(log.xp || 0);
  }

  const sorted = Object.entries(xpByNode)
    .filter(([, xp]) => xp > 0)
    .sort((a, b) => b[1] - a[1]);
  const topA = sorted[0] || null;
  const topB = sorted[1] || null;
  const weekXp = weekLogs.reduce((sum, log) => sum + Number(log.xp || 0), 0);
  const finishedCount = weekLogs.filter((log) => log.kind === 'task').length;
  const streakMod = state.streak % 7;
  const daysToBonus = state.streak === 0 ? 7 : streakMod === 0 ? 7 : 7 - streakMod;

  return { weekXp, finishedCount, topA, topB, daysToBonus };
}

export function getRecoveryMetrics(taskLogs) {
  const taskDates = [...new Set(taskLogs.filter((log) => log.kind === 'task').map((log) => log.date))].sort();

  let gapCount = 0;
  let recoveryDays = 0;

  for (let i = 1; i < taskDates.length; i += 1) {
    const gap = dateDistance(taskDates[i - 1], taskDates[i]);
    if (gap > 1) {
      gapCount += 1;
      recoveryDays += gap - 1;
    }
  }

  const avgRecovery = gapCount ? Number((recoveryDays / gapCount).toFixed(1)) : 0;
  return {
    gapCount,
    avgRecovery,
    lastTaskDate: taskDates[taskDates.length - 1] || '',
  };
}

export function getHeatmapData(taskLogs, today = getDateKey(), totalDays = 30) {
  const xpByDay = {};
  for (const log of taskLogs) {
    xpByDay[log.date] = (xpByDay[log.date] || 0) + Number(log.xp || 0);
  }

  const days = [];
  for (let i = totalDays - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    days.push({ date, xp: xpByDay[date] || 0 });
  }
  return days;
}

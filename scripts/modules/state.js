import { MAX_NODE_LEVEL, clampInt, getXpCap, syncUnlockState } from '../core.js';
import {
  LEGACY_STORAGE_KEYS,
  MAX_EVENTS,
  MAX_REFLECTIONS,
  MAX_TASK_LOGS,
  MAX_VISITS,
  STORAGE_KEY,
  difficultyMap,
} from './constants.js';

function defaultNodes() {
  return [
    { id: 'spark', name: '启动火花', desc: '把“想做”变成“先开工”。', parentId: null, row: 1, col: 2 },
    { id: 'breakdown', name: '任务拆解', desc: '把大目标拆成可执行步骤。', parentId: 'spark', row: 2, col: 2 },
    { id: 'focus', name: '专注护盾', desc: '减少中断，提升完成质量。', parentId: 'breakdown', row: 3, col: 1 },
    { id: 'deadline', name: '期限掌控', desc: '不拖到最后一天，提前收口。', parentId: 'breakdown', row: 3, col: 3 },
    { id: 'output', name: '稳定输出', desc: '连续完成，形成节奏。', parentId: 'focus', row: 4, col: 1 },
    { id: 'collab', name: '协作推进', desc: '推进协作任务并及时同步。', parentId: 'deadline', row: 4, col: 3 },
    { id: 'upgrade', name: '复盘升级', desc: '总结规律，持续优化。', parentId: 'output', row: 5, col: 2 },
  ];
}

function defaultTasks() {
  return [
    { id: 'spark-1', nodeId: 'spark', title: '立刻开始 5 分钟', difficulty: 'easy' },
    { id: 'spark-2', nodeId: 'spark', title: '把阻力写成一句话', difficulty: 'easy' },
    { id: 'spark-3', nodeId: 'spark', title: '完成一个最小动作', difficulty: 'medium' },
    { id: 'break-1', nodeId: 'breakdown', title: '把任务拆成 3 步', difficulty: 'easy' },
    { id: 'break-2', nodeId: 'breakdown', title: '给每一步估算时间', difficulty: 'medium' },
    { id: 'break-3', nodeId: 'breakdown', title: '删掉一个不必要步骤', difficulty: 'hard' },
    { id: 'focus-1', nodeId: 'focus', title: '专注 25 分钟不切屏', difficulty: 'medium' },
    { id: 'focus-2', nodeId: 'focus', title: '记录一次被打断原因', difficulty: 'easy' },
    { id: 'focus-3', nodeId: 'focus', title: '关闭 2 个干扰通知', difficulty: 'hard' },
    { id: 'dead-1', nodeId: 'deadline', title: '把截止日提前 1 天', difficulty: 'medium' },
    { id: 'dead-2', nodeId: 'deadline', title: '设置中间检查点', difficulty: 'easy' },
    { id: 'dead-3', nodeId: 'deadline', title: '今天收口一个悬而未决项', difficulty: 'hard' },
    { id: 'out-1', nodeId: 'output', title: '今天产出一个可交付结果', difficulty: 'medium' },
    { id: 'out-2', nodeId: 'output', title: '连续两段番茄钟', difficulty: 'hard' },
    { id: 'out-3', nodeId: 'output', title: '完成后主动做一次复查', difficulty: 'easy' },
    { id: 'col-1', nodeId: 'collab', title: '给协作者同步当前进展', difficulty: 'easy' },
    { id: 'col-2', nodeId: 'collab', title: '发出一个明确的协作请求', difficulty: 'medium' },
    { id: 'col-3', nodeId: 'collab', title: '对齐一次关键交付标准', difficulty: 'hard' },
    { id: 'up-1', nodeId: 'upgrade', title: '写下今日 1 条有效做法', difficulty: 'easy' },
    { id: 'up-2', nodeId: 'upgrade', title: '识别一个重复卡点并给对策', difficulty: 'medium' },
    { id: 'up-3', nodeId: 'upgrade', title: '整理一页本周经验清单', difficulty: 'hard' },
  ];
}

export function createInitialState() {
  const nodes = defaultNodes();
  const nodeProgress = {};
  for (const node of nodes) {
    nodeProgress[node.id] = { level: 1, xp: 0, unlocked: !node.parentId };
  }

  return {
    version: 5,
    selectedNodeId: nodes[0].id,
    totalXp: 0,
    streak: 0,
    lastCheckinDate: '',
    taskLogs: [],
    reflections: [],
    nodes,
    tasks: defaultTasks(),
    nodeProgress,
    growth: {
      weeklyChallenge: null,
      lastRecoveryAt: '',
    },
    meta: {
      firstVisitDate: '',
      visits: [],
      seenOnboarding: false,
      firstTaskCompleted: false,
      reminderEnabled: false,
      reminderTime: '20:30',
      lastReminderDate: '',
      syncCode: '',
      pushEnabled: false,
      lastPushSyncAt: '',
    },
    analytics: {
      events: [],
    },
  };
}

function sanitizeNode(node) {
  return {
    id: String(node.id),
    name: String(node.name).slice(0, 18),
    desc: String(node.desc || '').slice(0, 50),
    parentId: node.parentId ? String(node.parentId) : null,
    row: clampInt(node.row, 1, 20),
    col: clampInt(node.col, 1, 12),
    custom: Boolean(node.custom),
  };
}

function sanitizeTask(task) {
  const difficulty = difficultyMap[task.difficulty] ? task.difficulty : 'easy';
  return {
    id: String(task.id),
    nodeId: String(task.nodeId),
    title: String(task.title).slice(0, 48),
    difficulty,
    custom: Boolean(task.custom),
  };
}

function ensureTaskNodes(localState) {
  const ids = new Set(localState.nodes.map((node) => node.id));
  localState.tasks = localState.tasks.filter((task) => ids.has(task.nodeId));
  if (!ids.has(localState.selectedNodeId)) {
    localState.selectedNodeId = localState.nodes[0]?.id || '';
  }
}

export function ensureSelectedNode(localState) {
  if (localState.nodes.some((node) => node.id === localState.selectedNodeId)) return;
  const unlocked = localState.nodes.find((node) => localState.nodeProgress[node.id]?.unlocked);
  localState.selectedNodeId = unlocked ? unlocked.id : localState.nodes[0]?.id || '';
}

export function mergeState(source) {
  const base = createInitialState();
  if (!source || typeof source !== 'object') return base;

  const nodes = Array.isArray(source.nodes)
    ? source.nodes.filter((node) => node && typeof node.id === 'string' && typeof node.name === 'string')
    : base.nodes;
  base.nodes = nodes.length ? nodes.map(sanitizeNode) : base.nodes;

  const tasks = Array.isArray(source.tasks)
    ? source.tasks.filter(
        (task) => task && typeof task.id === 'string' && typeof task.nodeId === 'string' && typeof task.title === 'string',
      )
    : base.tasks;
  base.tasks = tasks.length ? tasks.map(sanitizeTask) : base.tasks;

  base.selectedNodeId = typeof source.selectedNodeId === 'string' ? source.selectedNodeId : base.selectedNodeId;
  base.totalXp = Number.isFinite(source.totalXp) ? Math.max(0, source.totalXp) : base.totalXp;
  base.streak = Number.isFinite(source.streak) ? Math.max(0, source.streak) : base.streak;
  base.lastCheckinDate = typeof source.lastCheckinDate === 'string' ? source.lastCheckinDate : '';

  if (Array.isArray(source.taskLogs)) {
    base.taskLogs = source.taskLogs
      .filter((log) => log && typeof log.date === 'string' && typeof log.nodeId === 'string')
      .slice(0, MAX_TASK_LOGS)
      .map((log) => ({
        ...log,
        difficulty: typeof log.difficulty === 'string' ? log.difficulty : null,
      }));
  }

  if (Array.isArray(source.reflections)) {
    base.reflections = source.reflections
      .filter((item) => item && typeof item.text === 'string' && typeof item.date === 'string')
      .slice(0, MAX_REFLECTIONS);
  }

  if (source.growth && typeof source.growth === 'object') {
    base.growth = {
      ...base.growth,
      lastRecoveryAt: typeof source.growth.lastRecoveryAt === 'string' ? source.growth.lastRecoveryAt : '',
      weeklyChallenge:
        source.growth.weeklyChallenge && typeof source.growth.weeklyChallenge === 'object'
          ? {
              ...source.growth.weeklyChallenge,
              progress: clampInt(source.growth.weeklyChallenge.progress, 0, 999),
              target: clampInt(source.growth.weeklyChallenge.target, 1, 999),
              rewardXp: clampInt(source.growth.weeklyChallenge.rewardXp, 1, 999),
              claimed: Boolean(source.growth.weeklyChallenge.claimed),
            }
          : null,
    };
  }

  if (source.meta && typeof source.meta === 'object') {
    base.meta = {
      ...base.meta,
      firstVisitDate: typeof source.meta.firstVisitDate === 'string' ? source.meta.firstVisitDate : base.meta.firstVisitDate,
      visits: Array.isArray(source.meta.visits)
        ? source.meta.visits.filter((v) => typeof v === 'string').slice(0, MAX_VISITS)
        : base.meta.visits,
      seenOnboarding: Boolean(source.meta.seenOnboarding),
      firstTaskCompleted: Boolean(source.meta.firstTaskCompleted),
      reminderEnabled: Boolean(source.meta.reminderEnabled),
      reminderTime: typeof source.meta.reminderTime === 'string' ? source.meta.reminderTime : base.meta.reminderTime,
      lastReminderDate: typeof source.meta.lastReminderDate === 'string' ? source.meta.lastReminderDate : '',
      syncCode: typeof source.meta.syncCode === 'string' ? source.meta.syncCode.slice(0, 60) : '',
      pushEnabled: Boolean(source.meta.pushEnabled),
      lastPushSyncAt: typeof source.meta.lastPushSyncAt === 'string' ? source.meta.lastPushSyncAt : '',
    };
  }

  if (source.analytics && typeof source.analytics === 'object' && Array.isArray(source.analytics.events)) {
    base.analytics.events = source.analytics.events
      .filter((event) => event && typeof event.type === 'string' && typeof event.date === 'string')
      .slice(0, MAX_EVENTS);
  }

  if (source.nodeProgress && typeof source.nodeProgress === 'object') {
    const merged = {};
    for (const node of base.nodes) {
      const incoming = source.nodeProgress[node.id] || {};
      const level = clampInt(incoming.level, 1, MAX_NODE_LEVEL);
      merged[node.id] = {
        level,
        xp: clampInt(incoming.xp, 0, getXpCap(level)),
        unlocked: Boolean(incoming.unlocked),
      };
    }
    base.nodeProgress = merged;
  }

  base.nodeProgress = syncUnlockState(base.nodes, base.nodeProgress);
  ensureTaskNodes(base);
  ensureSelectedNode(base);
  return base;
}

export function loadState(storageKey = STORAGE_KEY) {
  const candidates = [storageKey, ...LEGACY_STORAGE_KEYS];
  for (const key of candidates) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      return mergeState(JSON.parse(raw));
    } catch {
      // continue
    }
  }
  return createInitialState();
}

export function saveState(state, storageKey = STORAGE_KEY) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

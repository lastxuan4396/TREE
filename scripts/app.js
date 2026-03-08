import {
  MAX_NODE_LEVEL,
  STREAK_BONUS_XP,
  addDays,
  awardXp,
  clampInt,
  dateDistance,
  detectCompletionAnomaly,
  getDateKey,
  getXpCap,
  syncUnlockState,
  updateStreak,
} from './core.js';

const STORAGE_KEY = 'ability-tree-upgrade-v4';
const MAX_TASK_LOGS = 900;
const MAX_REFLECTIONS = 100;
const MAX_EVENTS = 800;
const MAX_VISITS = 140;

const ANTI_CHEAT_CONFIG = {
  minTaskIntervalMs: 4000,
  maxTasksPerMinute: 6,
  maxTasksPerDay: 40,
};

const difficultyMap = {
  easy: { label: '简单', xp: 10, className: 'easy' },
  medium: { label: '中等', xp: 20, className: 'medium' },
  hard: { label: '困难', xp: 35, className: 'hard' },
};

const refs = {
  treeGrid: document.getElementById('treeGrid'),
  treeLines: document.getElementById('treeLines'),
  taskList: document.getElementById('taskList'),
  taskPanelTitle: document.getElementById('taskPanelTitle'),
  taskPanelHint: document.getElementById('taskPanelHint'),
  statAccountLevel: document.getElementById('statAccountLevel'),
  statStreak: document.getElementById('statStreak'),
  statTodayXp: document.getElementById('statTodayXp'),
  statWeekXp: document.getElementById('statWeekXp'),
  weeklyReportList: document.getElementById('weeklyReportList'),
  reflectionInput: document.getElementById('reflectionInput'),
  saveReflectionBtn: document.getElementById('saveReflectionBtn'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  reflectionHistory: document.getElementById('reflectionHistory'),
  toast: document.getElementById('toast'),
  dailyTaskTitle: document.getElementById('dailyTaskTitle'),
  dailyTaskHint: document.getElementById('dailyTaskHint'),
  dailyTaskReason: document.getElementById('dailyTaskReason'),
  dailyCardState: document.getElementById('dailyCardState'),
  completeDailyBtn: document.getElementById('completeDailyBtn'),
  focusNodeBtn: document.getElementById('focusNodeBtn'),
  reminderToggle: document.getElementById('reminderToggle'),
  reminderTime: document.getElementById('reminderTime'),
  testReminderBtn: document.getElementById('testReminderBtn'),
  addCalendarBtn: document.getElementById('addCalendarBtn'),
  enablePushBtn: document.getElementById('enablePushBtn'),
  generateShareBtn: document.getElementById('generateShareBtn'),
  downloadShareBtn: document.getElementById('downloadShareBtn'),
  sharePreview: document.getElementById('sharePreview'),
  heatmap: document.getElementById('heatmap'),
  nodeGrowthChart: document.getElementById('nodeGrowthChart'),
  recoveryList: document.getElementById('recoveryList'),
  newNodeName: document.getElementById('newNodeName'),
  newNodeParent: document.getElementById('newNodeParent'),
  newNodeDesc: document.getElementById('newNodeDesc'),
  addNodeBtn: document.getElementById('addNodeBtn'),
  newTaskNode: document.getElementById('newTaskNode'),
  newTaskDifficulty: document.getElementById('newTaskDifficulty'),
  newTaskTitle: document.getElementById('newTaskTitle'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  syncCodeInput: document.getElementById('syncCodeInput'),
  generateSyncCodeBtn: document.getElementById('generateSyncCodeBtn'),
  cloudUploadBtn: document.getElementById('cloudUploadBtn'),
  cloudDownloadBtn: document.getElementById('cloudDownloadBtn'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataBtn: document.getElementById('importDataBtn'),
  importFileInput: document.getElementById('importFileInput'),
  analyticsList: document.getElementById('analyticsList'),
  onboardingModal: document.getElementById('onboardingModal'),
  startOnboardingBtn: document.getElementById('startOnboardingBtn'),
  skipOnboardingBtn: document.getElementById('skipOnboardingBtn'),
  installAppBtn: document.getElementById('installAppBtn'),
};

let deferredInstallPrompt = null;
let swRegistration = null;

let state = loadState();
registerPageOpen();
state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
ensureSelectedNode();
saveState();

bindEvents();
initPwa();
renderAll();
checkReminderFallback();
setInterval(() => checkReminderFallback(), 60 * 1000);

if (!state.meta.seenOnboarding) {
  trackEvent('onboarding_start');
  refs.onboardingModal.classList.remove('hidden');
  refs.startOnboardingBtn.focus();
}

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

function createInitialState() {
  const nodes = defaultNodes();
  const nodeProgress = {};
  for (const node of nodes) {
    nodeProgress[node.id] = { level: 1, xp: 0, unlocked: !node.parentId };
  }

  return {
    version: 4,
    selectedNodeId: nodes[0].id,
    totalXp: 0,
    streak: 0,
    lastCheckinDate: '',
    taskLogs: [],
    reflections: [],
    nodes,
    tasks: defaultTasks(),
    nodeProgress,
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    return mergeState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

function mergeState(source) {
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
      .slice(0, MAX_TASK_LOGS);
  }

  if (Array.isArray(source.reflections)) {
    base.reflections = source.reflections
      .filter((item) => item && typeof item.text === 'string' && typeof item.date === 'string')
      .slice(0, MAX_REFLECTIONS);
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
  return base;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function ensureSelectedNode() {
  if (state.nodes.some((node) => node.id === state.selectedNodeId)) return;
  const unlocked = state.nodes.find((node) => state.nodeProgress[node.id]?.unlocked);
  state.selectedNodeId = unlocked ? unlocked.id : state.nodes[0]?.id || '';
}

function registerPageOpen() {
  const today = getDateKey();
  if (!state.meta.firstVisitDate) state.meta.firstVisitDate = today;
  state.meta.visits = [today, ...state.meta.visits.filter((d) => d !== today)].slice(0, MAX_VISITS);
  trackEvent('page_open');
}

function bindEvents() {
  refs.saveReflectionBtn.addEventListener('click', saveReflection);
  refs.clearDataBtn.addEventListener('click', clearData);
  refs.completeDailyBtn.addEventListener('click', () => {
    const taskId = refs.completeDailyBtn.dataset.taskId;
    if (taskId) completeTask(taskId, 'daily_card');
  });
  refs.focusNodeBtn.addEventListener('click', () => {
    const nodeId = refs.focusNodeBtn.dataset.nodeId;
    if (nodeId) setSelectedNode(nodeId);
  });

  refs.reminderToggle.addEventListener('change', async () => {
    if (refs.reminderToggle.checked) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        refs.reminderToggle.checked = false;
        showToast('通知权限未开启，已退回仅站内提示。');
      }
    }
    state.meta.reminderEnabled = refs.reminderToggle.checked;
    trackEvent(state.meta.reminderEnabled ? 'reminder_enabled' : 'reminder_disabled');
    saveState();
    await syncReminderToServer();
  });

  refs.reminderTime.addEventListener('change', async () => {
    state.meta.reminderTime = refs.reminderTime.value || '20:30';
    saveState();
    await syncReminderToServer();
  });

  refs.enablePushBtn.addEventListener('click', async () => {
    await enablePushNotifications();
  });

  refs.testReminderBtn.addEventListener('click', async () => {
    sendReminder('这是一次测试提醒：今天先完成一个最小动作。');
    await triggerServerPushTest('这是来自 TREE 的推送测试。');
    trackEvent('reminder_test');
    saveState();
  });

  refs.addCalendarBtn.addEventListener('click', downloadReminderICS);

  refs.generateShareBtn.addEventListener('click', async () => {
    await generateShareImage();
  });

  refs.addNodeBtn.addEventListener('click', addCustomNode);
  refs.addTaskBtn.addEventListener('click', addCustomTask);

  refs.syncCodeInput.addEventListener('change', () => {
    state.meta.syncCode = refs.syncCodeInput.value.trim().slice(0, 60);
    saveState();
  });
  refs.generateSyncCodeBtn.addEventListener('click', generateSyncCode);
  refs.cloudUploadBtn.addEventListener('click', uploadCloudBackup);
  refs.cloudDownloadBtn.addEventListener('click', downloadCloudBackup);

  refs.exportDataBtn.addEventListener('click', exportData);
  refs.importDataBtn.addEventListener('click', () => refs.importFileInput.click());
  refs.importFileInput.addEventListener('change', importData);

  refs.startOnboardingBtn.addEventListener('click', () => {
    state.meta.seenOnboarding = true;
    refs.onboardingModal.classList.add('hidden');
    const daily = getDailyTaskRecommendation();
    if (daily?.task) setSelectedNode(daily.task.nodeId);
    trackEvent('onboarding_finish');
    saveState();
    showToast('先完成今日任务，30 秒就能看到进步。');
  });

  refs.skipOnboardingBtn.addEventListener('click', () => {
    state.meta.seenOnboarding = true;
    refs.onboardingModal.classList.add('hidden');
    trackEvent('onboarding_skip');
    saveState();
  });

  refs.onboardingModal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      refs.onboardingModal.classList.add('hidden');
      state.meta.seenOnboarding = true;
      trackEvent('onboarding_skip');
      saveState();
    }
  });

  window.addEventListener('resize', debounce(() => {
    renderGrowthChart();
    drawTreeLines();
  }, 120));
}

async function initPwa() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/service-worker.js');
    } catch {
      swRegistration = null;
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refs.installAppBtn.hidden = false;
  });

  refs.installAppBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    refs.installAppBtn.hidden = true;
  });

  if (state.meta.pushEnabled && state.meta.syncCode) {
    await syncReminderToServer();
  }
}

function setSelectedNode(nodeId) {
  state.selectedNodeId = nodeId;
  saveState();
  renderAll();
}

function applyXp(nodeId, amount) {
  const current = state.nodeProgress[nodeId] || { level: 1, xp: 0, unlocked: true };
  const result = awardXp(current, amount);
  state.totalXp += amount;
  state.nodeProgress[nodeId] = {
    ...current,
    level: result.level,
    xp: result.xp,
  };
  state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
  return result.levelUps;
}

function completeTask(taskId, source = 'task_list') {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;

  const progress = state.nodeProgress[task.nodeId];
  if (!progress?.unlocked) {
    showToast('该节点未解锁，请先把父节点升级到 Lv2。');
    return;
  }

  const today = getDateKey();
  const done = state.taskLogs.some((log) => log.kind === 'task' && log.taskId === taskId && log.date === today);
  if (done) {
    showToast('这个任务今天已经完成过了。');
    return;
  }

  const nowIso = new Date().toISOString();
  const anomaly = detectCompletionAnomaly(state.taskLogs, nowIso, today, ANTI_CHEAT_CONFIG);
  if (anomaly.blocked) {
    trackEvent('suspicious_block', { reason: anomaly.reason, source });
    saveState();
    showToast(`已拦截异常操作：${anomaly.reason}`);
    return;
  }

  const taskXp = difficultyMap[task.difficulty].xp;
  const streak = updateStreak(state.lastCheckinDate, state.streak, today);
  state.streak = streak.streak;
  state.lastCheckinDate = streak.lastCheckinDate;

  const levelUps = applyXp(task.nodeId, taskXp);
  state.taskLogs.unshift({
    id: makeId('log'),
    kind: 'task',
    date: today,
    taskId,
    nodeId: task.nodeId,
    xp: taskXp,
    title: task.title,
    completedAt: nowIso,
  });

  if (streak.bonus > 0) {
    applyXp(task.nodeId, streak.bonus);
    state.taskLogs.unshift({
      id: makeId('log'),
      kind: 'bonus',
      date: today,
      taskId: 'streak-bonus',
      nodeId: task.nodeId,
      xp: streak.bonus,
      title: '连续 7 天奖励',
      completedAt: nowIso,
    });
    trackEvent('streak_bonus', { bonus: streak.bonus });
  }

  state.taskLogs = state.taskLogs.slice(0, MAX_TASK_LOGS);
  trackEvent('complete_task', { taskId, nodeId: task.nodeId, source });
  if (!state.meta.firstTaskCompleted) {
    state.meta.firstTaskCompleted = true;
    trackEvent('first_task_complete', { taskId, nodeId: task.nodeId });
  }
  if (levelUps > 0) {
    trackEvent('level_up', { nodeId: task.nodeId, count: levelUps });
  }

  saveState();
  renderAll();

  const parts = [`完成任务 +${taskXp} XP`];
  if (levelUps > 0) parts.push(`升级 +${levelUps}`);
  if (streak.bonus > 0) parts.push(`连击奖励 +${STREAK_BONUS_XP} XP`);
  showToast(parts.join(' ｜ '));
}

function saveReflection() {
  const text = refs.reflectionInput.value.trim();
  if (!text) {
    showToast('先写一句复盘。');
    return;
  }
  state.reflections.unshift({ id: makeId('ref'), date: getDateKey(), text });
  state.reflections = state.reflections.slice(0, MAX_REFLECTIONS);
  refs.reflectionInput.value = '';
  trackEvent('save_reflection');
  saveState();
  renderReflections();
  renderAll();
  showToast('复盘已保存。');
}

function clearData() {
  const ok = window.confirm('确认重置全部数据吗？当前记录会被清空。');
  if (!ok) return;
  state = createInitialState();
  registerPageOpen();
  trackEvent('reset_data');
  saveState();
  renderAll();
  refs.onboardingModal.classList.remove('hidden');
  trackEvent('onboarding_start');
  refs.startOnboardingBtn.focus();
  showToast('已恢复到初始状态。');
}

function getDailyTaskRecommendation() {
  const today = getDateKey();
  const unlockedNodeIds = new Set(state.nodes.filter((node) => state.nodeProgress[node.id]?.unlocked).map((node) => node.id));

  const available = state.tasks.filter((task) => {
    if (!unlockedNodeIds.has(task.nodeId)) return false;
    return !state.taskLogs.some((log) => log.kind === 'task' && log.taskId === task.id && log.date === today);
  });

  if (!available.length) {
    const fallback = state.tasks.find((task) => unlockedNodeIds.has(task.nodeId));
    return { task: fallback || null, doneToday: true, reason: '今日任务已清空，做一次复盘巩固。' };
  }

  const interruptive = state.reflections
    .slice(0, 6)
    .some((item) => /拖延|打断|分心|焦虑|卡住/.test(item.text));

  const node14 = nodeCompletionInDays(14);
  const node7 = nodeCompletionInDays(7);

  let chosen = available[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let reason = '保持节奏，推进当前能力节点。';

  for (const task of available) {
    const progress = state.nodeProgress[task.nodeId] || { level: 1, xp: 0 };
    const ratio = progress.level >= MAX_NODE_LEVEL ? 1 : progress.xp / getXpCap(progress.level);
    const bottleneck = (1 - ratio) * 28;
    const lowMomentum = Math.max(0, 4 - (node7[task.nodeId] || 0)) * 6;
    const overFocusPenalty = (node14[task.nodeId] || 0) > 8 ? 8 : 0;
    const easyBonus = interruptive && task.difficulty === 'easy' ? 10 : 0;
    const score = bottleneck + lowMomentum + easyBonus - overFocusPenalty;

    if (score > bestScore) {
      bestScore = score;
      chosen = task;
      if (interruptive && task.difficulty === 'easy') {
        reason = '最近复盘出现分心/拖延，先做一个低阻力任务恢复节奏。';
      } else if (lowMomentum >= 18) {
        reason = '该节点近期推进偏慢，优先补足这里的进度。';
      } else {
        reason = '该节点当前进度最低，优先补齐短板。';
      }
    }
  }

  return { task: chosen, doneToday: false, reason };
}

function nodeCompletionInDays(days) {
  const today = getDateKey();
  const map = {};
  for (const log of state.taskLogs) {
    if (log.kind !== 'task') continue;
    const diff = dateDistance(log.date, today);
    if (diff < 0 || diff >= days) continue;
    map[log.nodeId] = (map[log.nodeId] || 0) + 1;
  }
  return map;
}

function renderAll() {
  ensureSelectedNode();
  renderStats();
  renderNodeSelectors();
  renderTree();
  renderTasks();
  renderDailyCard();
  renderWeeklyReport();
  renderGrowthVisuals();
  renderReflections();
  renderAnalytics();
}

function renderStats() {
  const today = getDateKey();
  const todayXp = state.taskLogs.filter((log) => log.date === today).reduce((sum, log) => sum + Number(log.xp || 0), 0);
  const weekXp = state.taskLogs
    .filter((log) => {
      const diff = dateDistance(log.date, today);
      return diff >= 0 && diff < 7;
    })
    .reduce((sum, log) => sum + Number(log.xp || 0), 0);

  refs.statAccountLevel.textContent = `Lv.${1 + Math.floor(state.totalXp / 180)}`;
  refs.statStreak.textContent = String(state.streak);
  refs.statTodayXp.textContent = String(todayXp);
  refs.statWeekXp.textContent = String(weekXp);
}

function computeNodeLayout(nodes) {
  const children = new Map();
  const nodeMap = new Map();
  const depths = {};

  for (const node of nodes) {
    children.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node.id);
  }

  const roots = nodes
    .filter((node) => !node.parentId || !nodeMap.has(node.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const queue = roots.map((node) => ({ id: node.id, depth: 1 }));
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (depths[id] && depths[id] <= depth) continue;
    depths[id] = depth;
    const next = children.get(id) || [];
    next.sort((a, b) => (nodeMap.get(a)?.name || '').localeCompare(nodeMap.get(b)?.name || '', 'zh-CN'));
    for (const childId of next) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }

  for (const node of nodes) {
    if (!depths[node.id]) depths[node.id] = 1;
  }

  const layers = {};
  for (const node of nodes) {
    const row = depths[node.id];
    if (!layers[row]) layers[row] = [];
    layers[row].push(node);
  }

  const layerRows = Object.keys(layers).map(Number).sort((a, b) => a - b);
  let maxCols = 3;
  for (const row of layerRows) {
    maxCols = Math.max(maxCols, layers[row].length);
  }

  const positions = {};
  for (const row of layerRows) {
    const layer = layers[row];
    layer.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const used = new Set();

    layer.forEach((node, index) => {
      const suggested = Math.round(((index + 1) * (maxCols + 1)) / (layer.length + 1));
      let col = Math.min(maxCols, Math.max(1, suggested));
      while (used.has(col) && col < maxCols) col += 1;
      while (used.has(col) && col > 1) col -= 1;
      used.add(col);
      positions[node.id] = { row, col };
    });
  }

  const orderedNodes = [...nodes].sort((a, b) => {
    const pa = positions[a.id] || { row: 1, col: 1 };
    const pb = positions[b.id] || { row: 1, col: 1 };
    return pa.row - pb.row || pa.col - pb.col || a.name.localeCompare(b.name, 'zh-CN');
  });

  return {
    positions,
    orderedNodes,
    maxCols,
    maxRows: Math.max(5, ...layerRows),
  };
}

function renderTree() {
  const existingSvg = refs.treeLines;
  refs.treeGrid.innerHTML = '';
  refs.treeGrid.appendChild(existingSvg);

  const layout = computeNodeLayout(state.nodes);
  refs.treeGrid.style.setProperty('--grid-cols', String(layout.maxCols));
  refs.treeGrid.style.gridTemplateRows = `repeat(${layout.maxRows}, minmax(84px, auto))`;

  for (const node of layout.orderedNodes) {
    const pos = layout.positions[node.id];
    const progress = state.nodeProgress[node.id] || { level: 1, xp: 0, unlocked: false };
    const isSelected = state.selectedNodeId === node.id;
    const cap = getXpCap(progress.level);
    const currentXp = progress.level >= MAX_NODE_LEVEL ? cap : progress.xp;
    const progressPct = Math.round((currentXp / cap) * 100);
    const parentName = node.parentId ? getNodeById(node.parentId)?.name || '' : '';

    const card = document.createElement('article');
    card.className = ['node-card', progress.unlocked ? 'unlocked' : 'locked', isSelected ? 'selected' : '']
      .filter(Boolean)
      .join(' ');
    card.style.gridColumn = String(pos.col);
    card.style.gridRow = String(pos.row);
    card.dataset.nodeId = node.id;
    card.tabIndex = progress.unlocked ? 0 : -1;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `${node.name}，等级 ${progress.level}，${progress.unlocked ? '已解锁' : '未解锁'}`);

    card.innerHTML = `
      <div class="node-head">
        <p class="node-name">${escapeHtml(node.name)}</p>
        <span class="level-badge">Lv.${progress.level}</span>
      </div>
      <p class="node-desc">${escapeHtml(node.desc)}</p>
      <div class="xp-track"><span style="width:${progressPct}%"></span></div>
      <div class="node-meta">${progress.level >= MAX_NODE_LEVEL ? '已满级' : `XP ${currentXp} / ${cap}`}</div>
      <button class="btn-plain" data-action="select" data-node="${node.id}" ${
      !progress.unlocked ? 'disabled' : ''
    } aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="切换到${escapeHtml(node.name)}节点">${
      isSelected ? '当前节点' : '切换节点'
    }</button>
      ${
        !progress.unlocked && parentName
          ? `<div class="node-meta">解锁条件：${escapeHtml(parentName)} 达到 Lv2</div>`
          : ''
      }
    `;

    refs.treeGrid.appendChild(card);
  }

  refs.treeGrid.querySelectorAll('[data-action="select"]').forEach((btn) => {
    btn.addEventListener('click', () => setSelectedNode(btn.dataset.node));
  });

  refs.treeGrid.querySelectorAll('.node-card').forEach((card) => {
    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && state.nodeProgress[card.dataset.nodeId]?.unlocked) {
        event.preventDefault();
        setSelectedNode(card.dataset.nodeId);
      }
    });
  });

  requestAnimationFrame(() => drawTreeLines(layout.positions));
}

function drawTreeLines(positionMap = null) {
  const wrapRect = refs.treeGrid.getBoundingClientRect();
  const width = Math.max(1, wrapRect.width);
  const height = Math.max(1, wrapRect.height);

  refs.treeLines.setAttribute('width', width);
  refs.treeLines.setAttribute('height', height);
  refs.treeLines.setAttribute('viewBox', `0 0 ${width} ${height}`);
  refs.treeLines.innerHTML = '';

  for (const node of state.nodes) {
    if (!node.parentId) continue;
    if (positionMap && (!positionMap[node.id] || !positionMap[node.parentId])) continue;

    const fromEl = refs.treeGrid.querySelector(`[data-node-id="${node.parentId}"]`);
    const toEl = refs.treeGrid.querySelector(`[data-node-id="${node.id}"]`);
    if (!fromEl || !toEl) continue;

    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const startX = a.left - wrapRect.left + a.width / 2;
    const startY = a.top - wrapRect.top + a.height;
    const endX = b.left - wrapRect.left + b.width / 2;
    const endY = b.top - wrapRect.top;
    const c1Y = startY + (endY - startY) * 0.4;
    const c2Y = endY - (endY - startY) * 0.4;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${c1Y}, ${endX} ${c2Y}, ${endX} ${endY}`);
    path.setAttribute('stroke', 'rgba(15, 118, 110, 0.34)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    refs.treeLines.appendChild(path);
  }
}

function renderTasks() {
  const selected = getNodeById(state.selectedNodeId);
  if (!selected) return;

  const selectedProgress = state.nodeProgress[selected.id];
  refs.taskPanelTitle.textContent = `${selected.name} · 可执行任务`;
  refs.taskPanelHint.textContent = selectedProgress.unlocked
    ? '完成任务获得 XP。当天重复任务不重复计分。'
    : '节点尚未解锁，请先升级父节点。';

  const nodeTasks = state.tasks.filter((task) => task.nodeId === selected.id);
  const today = getDateKey();

  if (!nodeTasks.length) {
    refs.taskList.innerHTML = '<article class="task-item">当前节点还没有任务，去下方添加一个吧。</article>';
    return;
  }

  refs.taskList.innerHTML = '';
  for (const task of nodeTasks) {
    const meta = difficultyMap[task.difficulty];
    const doneToday = state.taskLogs.some((log) => log.kind === 'task' && log.taskId === task.id && log.date === today);
    const disabled = !selectedProgress.unlocked || doneToday;

    const item = document.createElement('article');
    item.className = 'task-item';
    item.innerHTML = `
      <p class="task-title">${escapeHtml(task.title)}</p>
      <div class="task-meta">
        <span class="tag ${meta.className}">${meta.label}</span>
        <span>奖励 +${meta.xp} XP</span>
      </div>
      <button class="${doneToday ? 'btn-plain' : 'btn-main'}" data-action="complete" data-task="${task.id}" ${
      disabled ? 'disabled' : ''
    }>
        ${doneToday ? '今日已完成' : '完成任务'}
      </button>
    `;
    refs.taskList.appendChild(item);
  }

  refs.taskList.querySelectorAll('[data-action="complete"]').forEach((btn) => {
    btn.addEventListener('click', () => completeTask(btn.dataset.task, 'task_list'));
  });
}

function renderDailyCard() {
  const daily = getDailyTaskRecommendation();

  if (!daily.task) {
    refs.dailyTaskTitle.textContent = '暂无可用任务';
    refs.dailyTaskHint.textContent = '请先创建节点和任务。';
    refs.dailyTaskReason.textContent = '先添加一个任务再开始。';
    refs.completeDailyBtn.disabled = true;
    refs.focusNodeBtn.disabled = true;
    refs.completeDailyBtn.dataset.taskId = '';
    refs.focusNodeBtn.dataset.nodeId = '';
    refs.dailyCardState.textContent = '待创建';
    refs.dailyCardState.classList.remove('done');
    return;
  }

  const meta = difficultyMap[daily.task.difficulty];
  refs.dailyTaskTitle.textContent = daily.task.title;
  refs.dailyTaskHint.textContent = `节点：${getNodeById(daily.task.nodeId)?.name || '-'} ｜ 难度：${meta.label} ｜ 奖励：+${meta.xp} XP`;
  refs.dailyTaskReason.textContent = `推荐理由：${daily.reason}`;
  refs.completeDailyBtn.dataset.taskId = daily.doneToday ? '' : daily.task.id;
  refs.focusNodeBtn.dataset.nodeId = daily.task.nodeId;
  refs.completeDailyBtn.disabled = daily.doneToday;
  refs.focusNodeBtn.disabled = false;
  refs.dailyCardState.textContent = daily.doneToday ? '已完成' : '待完成';
  refs.dailyCardState.classList.toggle('done', daily.doneToday);
}

function getWeeklySummary() {
  const today = getDateKey();
  const weekLogs = state.taskLogs.filter((log) => {
    const diff = dateDistance(log.date, today);
    return diff >= 0 && diff < 7;
  });

  const xpByNode = {};
  for (const node of state.nodes) xpByNode[node.id] = 0;
  for (const log of weekLogs) {
    xpByNode[log.nodeId] = (xpByNode[log.nodeId] || 0) + Number(log.xp || 0);
  }

  const sorted = Object.entries(xpByNode).filter(([, xp]) => xp > 0).sort((a, b) => b[1] - a[1]);
  const topA = sorted[0] || null;
  const topB = sorted[1] || null;
  const weekXp = weekLogs.reduce((sum, log) => sum + Number(log.xp || 0), 0);
  const finishedCount = weekLogs.filter((log) => log.kind === 'task').length;
  const streakMod = state.streak % 7;
  const daysToBonus = state.streak === 0 ? 7 : streakMod === 0 ? 7 : 7 - streakMod;

  return { weekXp, finishedCount, topA, topB, daysToBonus };
}

function renderWeeklyReport() {
  const summary = getWeeklySummary();
  const topAName = summary.topA ? getNodeById(summary.topA[0])?.name || '-' : '-';
  const topBName = summary.topB ? getNodeById(summary.topB[0])?.name || '-' : '-';

  const lines = [
    `本周累计 <strong>${summary.weekXp}</strong> XP，完成任务 <strong>${summary.finishedCount}</strong> 次。`,
    summary.topA
      ? `进步最多：<strong>${escapeHtml(topAName)}</strong>（+${summary.topA[1]} XP）`
      : '还没有周内记录，先完成一个今日任务。',
    summary.topB
      ? `第二增长：<strong>${escapeHtml(topBName)}</strong>（+${summary.topB[1]} XP）`
      : '再点亮一个节点，会更容易形成习惯。',
    `连续进步 <strong>${state.streak}</strong> 天，下次 7 天奖励还差 <strong>${summary.daysToBonus}</strong> 天。`,
  ];

  refs.weeklyReportList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
}

function renderGrowthVisuals() {
  renderHeatmap();
  renderGrowthChart();
  renderRecoveryMetrics();
}

function renderHeatmap() {
  const today = getDateKey();
  const xpByDay = {};
  for (const log of state.taskLogs) {
    xpByDay[log.date] = (xpByDay[log.date] || 0) + Number(log.xp || 0);
  }

  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    days.push({ date, xp: xpByDay[date] || 0 });
  }

  refs.heatmap.innerHTML = days
    .map((item) => {
      const cls = item.xp >= 80 ? 'lv4' : item.xp >= 45 ? 'lv3' : item.xp >= 20 ? 'lv2' : item.xp > 0 ? 'lv1' : 'lv0';
      return `<span class="heatmap-day ${cls}" title="${item.date}：${item.xp} XP"></span>`;
    })
    .join('');
}

function renderGrowthChart() {
  const canvas = refs.nodeGrowthChart;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const today = getDateKey();
  const days = [];
  for (let i = 13; i >= 0; i -= 1) days.push(addDays(today, -i));

  const nodeIds = state.nodes.slice(0, 4).map((node) => node.id);
  const colors = ['#0f766e', '#d97706', '#7c3aed', '#2563eb'];

  const maxValue = Math.max(
    20,
    ...nodeIds.map((nodeId) => {
      let cum = 0;
      let peak = 0;
      for (const day of days) {
        const value = state.taskLogs
          .filter((log) => log.nodeId === nodeId && log.date === day)
          .reduce((sum, log) => sum + Number(log.xp || 0), 0);
        cum += value;
        peak = Math.max(peak, cum);
      }
      return peak;
    }),
  );

  ctx.strokeStyle = '#d5dede';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 20 + (i * (height - 40)) / 4;
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 12, y);
    ctx.stroke();
  }

  nodeIds.forEach((nodeId, index) => {
    const color = colors[index % colors.length];
    let cumulative = 0;
    const points = days.map((day, i) => {
      const value = state.taskLogs
        .filter((log) => log.nodeId === nodeId && log.date === day)
        .reduce((sum, log) => sum + Number(log.xp || 0), 0);
      cumulative += value;
      const x = 36 + (i * (width - 52)) / (days.length - 1);
      const y = height - 20 - (cumulative / maxValue) * (height - 40);
      return { x, y };
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    const nodeName = getNodeById(nodeId)?.name || nodeId;
    ctx.fillStyle = color;
    ctx.font = '12px "Noto Sans SC"';
    ctx.fillText(nodeName, width - 130, 18 + index * 14);
  });
}

function renderRecoveryMetrics() {
  const taskDates = [...new Set(state.taskLogs.filter((log) => log.kind === 'task').map((log) => log.date))].sort();

  let gapCount = 0;
  let recoveryDays = 0;

  for (let i = 1; i < taskDates.length; i += 1) {
    const gap = dateDistance(taskDates[i - 1], taskDates[i]);
    if (gap > 1) {
      gapCount += 1;
      recoveryDays += gap - 1;
    }
  }

  const avgRecovery = gapCount ? (recoveryDays / gapCount).toFixed(1) : '0';
  const lines = [
    `中断后恢复次数：<strong>${gapCount}</strong> 次`,
    `平均恢复天数：<strong>${avgRecovery}</strong> 天`,
    `最近一次任务：<strong>${taskDates[taskDates.length - 1] || '-'}</strong>`,
  ];

  refs.recoveryList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
}

async function generateShareImage() {
  const summary = getWeeklySummary();
  const level = 1 + Math.floor(state.totalXp / 180);
  const topName = summary.topA ? getNodeById(summary.topA[0])?.name || '暂无' : '暂无';

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showToast('当前浏览器不支持分享图生成。');
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#f8e8cb');
  gradient.addColorStop(1, '#d6f2ea');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  roundRect(ctx, 70, 90, 940, 1170, 40);
  ctx.fill();

  ctx.fillStyle = '#203238';
  ctx.font = '900 64px "Noto Sans SC"';
  ctx.fillText('本周能力树战报', 130, 210);

  ctx.font = '500 36px "Noto Sans SC"';
  ctx.fillStyle = '#4b6970';
  ctx.fillText(`总等级 Lv.${level}`, 130, 280);

  const blocks = [
    ['本周 XP', String(summary.weekXp)],
    ['本周完成', `${summary.finishedCount} 次`],
    ['连续进步', `${state.streak} 天`],
    ['重点增长', topName],
  ];

  let y = 360;
  for (const [label, value] of blocks) {
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    roundRect(ctx, 130, y - 52, 820, 120, 24);
    ctx.fill();

    ctx.fillStyle = '#4b6970';
    ctx.font = '500 32px "Noto Sans SC"';
    ctx.fillText(label, 170, y + 14);

    ctx.fillStyle = '#163138';
    ctx.font = '800 42px "Noto Sans SC"';
    ctx.fillText(String(value), 500, y + 14);
    y += 150;
  }

  ctx.fillStyle = '#4b6970';
  ctx.font = '500 30px "Noto Sans SC"';
  ctx.fillText('今天先做 1 个最小动作，明天的你会感谢现在的你。', 130, 1080);

  ctx.fillStyle = '#2b4b53';
  ctx.font = '700 28px "Noto Sans SC"';
  ctx.fillText(`生成时间：${getDateKey()}`, 130, 1140);

  const dataUrl = canvas.toDataURL('image/png');
  refs.sharePreview.src = dataUrl;
  refs.sharePreview.hidden = false;
  refs.downloadShareBtn.href = dataUrl;
  refs.downloadShareBtn.classList.remove('disabled');
  refs.downloadShareBtn.download = `ability-tree-weekly-${getDateKey()}.png`;

  trackEvent('generate_share_image');
  saveState();
  showToast('分享图已生成，可直接下载。');
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function renderReflections() {
  const recent = state.reflections.slice(0, 8);
  if (!recent.length) {
    refs.reflectionHistory.innerHTML = '<li>暂无复盘记录。</li>';
    return;
  }

  refs.reflectionHistory.innerHTML = recent
    .map(
      (item) => `
      <li>
        <strong>${escapeHtml(item.date)}</strong>
        <span>${escapeHtml(item.text)}</span>
      </li>
    `,
    )
    .join('');
}

function renderNodeSelectors() {
  const layout = computeNodeLayout(state.nodes);
  const nodes = [...state.nodes].sort((a, b) => {
    const pa = layout.positions[a.id] || { row: 1, col: 1 };
    const pb = layout.positions[b.id] || { row: 1, col: 1 };
    return pa.row - pb.row || pa.col - pb.col || a.name.localeCompare(b.name, 'zh-CN');
  });

  const parentOld = refs.newNodeParent.value;
  refs.newNodeParent.innerHTML = `<option value="">无（新根节点）</option>${nodes
    .map((node) => `<option value="${node.id}">${escapeHtml(node.name)}</option>`)
    .join('')}`;
  if ([...refs.newNodeParent.options].some((opt) => opt.value === parentOld)) {
    refs.newNodeParent.value = parentOld;
  }

  const taskNodeOld = refs.newTaskNode.value || state.selectedNodeId;
  refs.newTaskNode.innerHTML = nodes
    .map((node) => `<option value="${node.id}">${escapeHtml(node.name)}</option>`)
    .join('');
  if ([...refs.newTaskNode.options].some((opt) => opt.value === taskNodeOld)) {
    refs.newTaskNode.value = taskNodeOld;
  } else if (state.selectedNodeId) {
    refs.newTaskNode.value = state.selectedNodeId;
  }

  refs.reminderToggle.checked = state.meta.reminderEnabled;
  refs.reminderTime.value = state.meta.reminderTime || '20:30';
  refs.syncCodeInput.value = state.meta.syncCode || '';
  refs.enablePushBtn.textContent = state.meta.pushEnabled ? '推送已启用' : '启用推送';
}

function addCustomNode() {
  const name = refs.newNodeName.value.trim();
  if (!name) {
    showToast('请输入节点名称。');
    return;
  }

  const desc = refs.newNodeDesc.value.trim() || '自定义能力节点';
  const parentId = refs.newNodeParent.value || null;

  const id = makeId('node');
  state.nodes.push({ id, name: name.slice(0, 18), desc: desc.slice(0, 50), parentId, row: 1, col: 1, custom: true });
  state.nodeProgress[id] = { level: 1, xp: 0, unlocked: !parentId };
  state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
  state.selectedNodeId = id;

  refs.newNodeName.value = '';
  refs.newNodeDesc.value = '';
  refs.newNodeParent.value = '';

  trackEvent('add_node', { nodeId: id, hasParent: Boolean(parentId) });
  saveState();
  renderAll();
  showToast('自定义节点已添加。');
}

function addCustomTask() {
  const nodeId = refs.newTaskNode.value;
  const title = refs.newTaskTitle.value.trim();
  const difficulty = refs.newTaskDifficulty.value;

  if (!nodeId) {
    showToast('请选择任务节点。');
    return;
  }
  if (!title) {
    showToast('请输入任务内容。');
    return;
  }
  if (!difficultyMap[difficulty]) {
    showToast('任务难度不合法。');
    return;
  }

  const id = makeId('task');
  state.tasks.push({ id, nodeId, title: title.slice(0, 48), difficulty, custom: true });
  state.selectedNodeId = nodeId;
  refs.newTaskTitle.value = '';

  trackEvent('add_task', { taskId: id, nodeId, difficulty });
  saveState();
  renderAll();
  showToast('自定义任务已添加。');
}

function buildBackupPayload() {
  return {
    exportedAt: new Date().toISOString(),
    version: state.version,
    state,
  };
}

function exportData() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ability-tree-backup-${getDateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  trackEvent('export_data');
  saveState();
  showToast('已导出 JSON 备份。');
}

async function importData() {
  const file = refs.importFileInput.files?.[0];
  refs.importFileInput.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state = mergeState(parsed.state || parsed);
    state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
    ensureSelectedNode();
    trackEvent('import_data', { version: parsed.version || null });
    saveState();
    renderAll();
    showToast('导入成功。');
  } catch {
    showToast('导入失败：文件格式不正确。');
  }
}

function generateSyncCode() {
  const code = `tree-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}-${Date.now()
    .toString(36)
    .slice(-4)}`;
  refs.syncCodeInput.value = code;
  state.meta.syncCode = code;
  trackEvent('generate_sync_code');
  saveState();
  showToast('已生成同步口令。');
}

async function uploadCloudBackup() {
  const syncCode = refs.syncCodeInput.value.trim();
  if (!syncCode) {
    showToast('请先填写同步口令。');
    return;
  }

  try {
    const res = await fetch('/api/sync/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncCode, payload: buildBackupPayload() }),
    });

    if (!res.ok) throw new Error(`服务响应 ${res.status}`);

    state.meta.syncCode = syncCode;
    trackEvent('cloud_upload');
    saveState();
    showToast('云端备份成功。');
  } catch (error) {
    showToast(`云端备份失败：${error.message}`);
  }
}

async function downloadCloudBackup() {
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) {
    showToast('请先填写同步口令。');
    return;
  }

  try {
    const res = await fetch('/api/sync/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncCode }),
    });

    if (!res.ok) throw new Error(`服务响应 ${res.status}`);

    const data = await res.json();
    if (!data?.payload) throw new Error('云端没有备份');

    state = mergeState(data.payload.state || data.payload);
    state.meta.syncCode = syncCode;
    state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
    ensureSelectedNode();
    trackEvent('cloud_download');
    saveState();
    renderAll();
    showToast('已从云端恢复数据。');
  } catch (error) {
    showToast(`云端恢复失败：${error.message}`);
  }
}

async function enablePushNotifications() {
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) {
    showToast('请先填写同步口令，再启用推送。');
    return;
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('当前浏览器不支持 Web Push。');
    return;
  }

  const permissionOk = await ensureNotificationPermission();
  if (!permissionOk) {
    showToast('请先在浏览器允许通知权限。');
    return;
  }

  try {
    if (!swRegistration) {
      swRegistration = await navigator.serviceWorker.register('/service-worker.js');
    }

    const keyRes = await fetch('/api/push/public-key');
    if (!keyRes.ok) throw new Error(`获取公钥失败 ${keyRes.status}`);
    const keyData = await keyRes.json();
    const publicKey = keyData?.publicKey;
    if (!publicKey) throw new Error('公钥为空');

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const subRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncCode, subscription }),
    });
    if (!subRes.ok) throw new Error(`订阅失败 ${subRes.status}`);

    state.meta.syncCode = syncCode;
    state.meta.pushEnabled = true;
    state.meta.lastPushSyncAt = new Date().toISOString();
    trackEvent('push_enable');
    saveState();

    await syncReminderToServer();
    refs.enablePushBtn.textContent = '推送已启用';
    showToast('Web Push 已启用。');
  } catch (error) {
    showToast(`启用推送失败：${error.message}`);
  }
}

async function syncReminderToServer() {
  if (!state.meta.pushEnabled) return;
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) return;

  try {
    const res = await fetch('/api/reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncCode,
        enabled: Boolean(state.meta.reminderEnabled),
        time: state.meta.reminderTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }),
    });
    if (!res.ok) throw new Error(`提醒同步失败 ${res.status}`);
    state.meta.lastPushSyncAt = new Date().toISOString();
    saveState();
  } catch {
    // fallback only
  }
}

async function triggerServerPushTest(message) {
  if (!state.meta.pushEnabled) return;
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) return;

  try {
    await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncCode, message }),
    });
  } catch {
    // fallback only
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function downloadReminderICS() {
  const timeText = refs.reminderTime.value || '20:30';
  const [h, m] = timeText.split(':').map((v) => Number(v));
  const now = new Date();
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 10);

  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TREE//Daily Reminder//CN',
    'BEGIN:VEVENT',
    `UID:${makeId('ics')}@tree`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    'RRULE:FREQ=DAILY',
    'SUMMARY:TREE 今日任务提醒',
    'DESCRIPTION:先完成一个最小动作，然后回到 TREE 记录进度。',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:TREE 今日任务提醒',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tree-daily-reminder-${timeText.replace(':', '')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  trackEvent('calendar_reminder_export', { time: timeText });
  saveState();
  showToast('已生成日历提醒文件。');
}

function toICSDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function renderAnalytics() {
  const events = state.analytics.events;
  const openCount = events.filter((e) => e.type === 'page_open').length;
  const completeCount = events.filter((e) => e.type === 'complete_task').length;
  const levelUpCount = events.filter((e) => e.type === 'level_up').length;
  const onboardingStart = events.filter((e) => e.type === 'onboarding_start').length;
  const onboardingFinish = events.filter((e) => e.type === 'onboarding_finish').length;
  const firstTask = events.filter((e) => e.type === 'first_task_complete').length;
  const suspiciousBlocked = events.filter((e) => e.type === 'suspicious_block').length;

  const d1 = calculateRetention(state.meta.visits, 1);
  const d7 = calculateRetention(state.meta.visits, 7);

  const weekly = computeWeeklyLayerMetrics();
  const onboardingRate = onboardingStart === 0 ? 0 : Math.round((onboardingFinish / onboardingStart) * 100);
  const activationRate = onboardingFinish === 0 ? 0 : Math.round((firstTask / onboardingFinish) * 100);

  const lines = [
    `页面打开：<strong>${openCount}</strong> 次`,
    `完成任务：<strong>${completeCount}</strong> 次`,
    `触发升级：<strong>${levelUpCount}</strong> 次`,
    `新手漏斗：开始 <strong>${onboardingStart}</strong> / 完成 <strong>${onboardingFinish}</strong>（完成率 ${onboardingRate}%）`,
    `激活率：首任务完成 <strong>${firstTask}</strong>（相对完成引导 ${activationRate}%）`,
    `D1 留存：<strong>${d1.rate}%</strong>（${d1.retained}/${d1.eligible}）`,
    `D7 留存：<strong>${d7.rate}%</strong>（${d7.retained}/${d7.eligible}）`,
    `本周分层：新增 <strong>${weekly.newUsers}</strong> ｜ 激活 <strong>${weekly.activatedUsers}</strong> ｜ 留存 <strong>${weekly.retainedUsers}</strong> ｜ 回流 <strong>${weekly.reactivatedUsers}</strong>`,
    `异常拦截：<strong>${suspiciousBlocked}</strong> 次`,
  ];

  refs.analyticsList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
}

function computeWeeklyLayerMetrics() {
  const today = getDateKey();
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

function getWeekStart(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return getDateKey(date);
}

function calculateRetention(visits, days) {
  const unique = [...new Set(visits)].sort();
  if (!unique.length) return { eligible: 0, retained: 0, rate: 0 };

  const visitSet = new Set(unique);
  const today = getDateKey();
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

function checkReminderFallback() {
  if (!state.meta.reminderEnabled || state.meta.pushEnabled) return;

  const now = new Date();
  const today = getDateKey(now);
  if (state.meta.lastReminderDate === today) return;

  const [h, m] = (state.meta.reminderTime || '20:30').split(':').map((v) => Number(v));
  const passed = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  if (!passed) return;

  sendReminder('今日任务时间到：先完成一个最小动作。');
  state.meta.lastReminderDate = today;
  trackEvent('daily_reminder_local');
  saveState();
}

function sendReminder(message) {
  showToast(message);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('能力树升级提醒', { body: message });
    } catch {
      // noop
    }
  }
}

async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

function trackEvent(type, meta = {}) {
  state.analytics.events.unshift({
    id: makeId('evt'),
    type,
    date: new Date().toISOString(),
    meta,
  });
  state.analytics.events = state.analytics.events.slice(0, MAX_EVENTS);
}

function getNodeById(nodeId) {
  return state.nodes.find((node) => node.id === nodeId);
}

function makeId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.remove('show'), 1900);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

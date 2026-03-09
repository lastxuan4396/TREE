import {
  MAX_NODE_LEVEL,
  STREAK_BONUS_XP,
  addDays,
  awardXp,
  dateDistance,
  detectCompletionAnomaly,
  getDateKey,
  getXpCap,
  syncUnlockState,
  updateStreak,
} from './core.js';
import { calculateRetention, computeWeeklyLayerMetrics, getHeatmapData, getRecoveryMetrics, getWeeklySummary } from './modules/analytics.js';
import { apiClient } from './modules/api-client.js';
import { ANTI_CHEAT_CONFIG, MAX_EVENTS, MAX_REFLECTIONS, MAX_TASK_LOGS, MAX_VISITS, difficultyMap } from './modules/constants.js';
import { computeAdaptiveXp, computeWeeklyChallengeProgress, ensureWeeklyChallenge, getDailyTaskRecommendation } from './modules/growth.js';
import { ensureSelectedNode, loadState as loadStoredState, mergeState, saveState as saveStoredState, createInitialState } from './modules/state.js';
import { generateRoadmap, getTemplateById, getTemplatePacks, importTemplatePack } from './modules/templates.js';
import { debounce, escapeHtml, makeId, refs, showToast } from './modules/ui.js';

let deferredInstallPrompt = null;
let swRegistration = null;

let state = loadStoredState();
registerPageOpen();
state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
ensureSelectedNode(state);
ensureWeeklyChallenge(state);
ensureFeatureState();
saveState();

bindEvents();
initFeatureUi();
initPwa();
renderAll();
checkReminderFallback();
setInterval(() => checkReminderFallback(), 60 * 1000);

if (!state.meta.seenOnboarding) {
  trackEvent('onboarding_start');
  refs.onboardingModal.classList.remove('hidden');
  refs.startOnboardingBtn.focus();
}

function saveState() {
  saveStoredState(state);
}

function ensureFeatureState() {
  if (!state.growth || typeof state.growth !== 'object') {
    state.growth = {};
  }
  if (!state.growth.roadmapTemplate) {
    state.growth.roadmapTemplate = 'procrastination-recovery';
  }

  if (!state.social || typeof state.social !== 'object') {
    state.social = {};
  }
  state.social.teamCode = state.social.teamCode || '';
  state.social.memberId = state.social.memberId || '';
  state.social.alias = state.social.alias || '';
  state.social.members = Array.isArray(state.social.members) ? state.social.members : [];
  state.social.progress = state.social.progress && typeof state.social.progress === 'object' ? state.social.progress : {};
  state.social.cheers = Array.isArray(state.social.cheers) ? state.social.cheers : [];
  state.social.updatedAt = state.social.updatedAt || '';

  if (!state.rewards || typeof state.rewards !== 'object') {
    state.rewards = { points: 0, items: [], history: [] };
  }
  state.rewards.points = Number.isFinite(Number(state.rewards.points)) ? Math.max(0, Number(state.rewards.points)) : 0;
  state.rewards.items = Array.isArray(state.rewards.items) ? state.rewards.items : [];
  state.rewards.history = Array.isArray(state.rewards.history) ? state.rewards.history : [];

  if (!state.wellbeing || typeof state.wellbeing !== 'object') {
    state.wellbeing = {};
  }
  state.wellbeing.moodBefore = state.wellbeing.moodBefore || 3;
  state.wellbeing.energyBefore = state.wellbeing.energyBefore || 3;
  state.wellbeing.moodAfter = state.wellbeing.moodAfter || 4;
  state.wellbeing.energyAfter = state.wellbeing.energyAfter || 4;
  state.wellbeing.logs = Array.isArray(state.wellbeing.logs) ? state.wellbeing.logs : [];

  if (!state.report || typeof state.report !== 'object') {
    state.report = {};
  }
  state.report.enabled = Boolean(state.report.enabled);
  state.report.webhookUrl = state.report.webhookUrl || '';
  state.report.lastStatus = state.report.lastStatus || '';
  state.report.lastSentWeekKey = state.report.lastSentWeekKey || '';
  state.report.updatedAt = state.report.updatedAt || '';
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
  refs.publishShareBtn.addEventListener('click', publishShareLink);
  refs.claimChallengeBtn.addEventListener('click', claimWeeklyChallenge);
  refs.regenerateRoadmapBtn.addEventListener('click', regenerateRoadmap);
  refs.roadmapTemplateSelect.addEventListener('change', () => {
    state.growth.roadmapTemplate = refs.roadmapTemplateSelect.value;
    regenerateRoadmap();
  });
  refs.completeRescueBtn.addEventListener('click', completeRescueTask);

  refs.moodBefore.addEventListener('change', () => {
    state.wellbeing.moodBefore = Number(refs.moodBefore.value || 3);
    saveState();
  });
  refs.energyBefore.addEventListener('change', () => {
    state.wellbeing.energyBefore = Number(refs.energyBefore.value || 3);
    saveState();
  });
  refs.moodAfter.addEventListener('change', () => {
    state.wellbeing.moodAfter = Number(refs.moodAfter.value || 4);
    saveState();
  });
  refs.energyAfter.addEventListener('change', () => {
    state.wellbeing.energyAfter = Number(refs.energyAfter.value || 4);
    saveState();
  });

  refs.aiAdviceBtn.addEventListener('click', generateAiAdvice);
  refs.importTemplateBtn.addEventListener('click', importMarketTemplate);
  refs.createTeamBtn.addEventListener('click', createTeam);
  refs.joinTeamBtn.addEventListener('click', joinTeam);
  refs.syncTeamBtn.addEventListener('click', syncTeamProgress);
  refs.sendCheerBtn.addEventListener('click', sendTeamCheer);
  refs.addRewardBtn.addEventListener('click', addRewardItem);
  refs.saveReportConfigBtn.addEventListener('click', saveReportConfig);
  refs.testReportBtn.addEventListener('click', testReportSend);

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
    const daily = getDailyTaskRecommendation(state, difficultyMap, MAX_NODE_LEVEL);
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

function initFeatureUi() {
  initTemplateSelectors();
  initWellbeingSelectors();
  if (state.social.alias) refs.teamAliasInput.value = state.social.alias;
  if (state.social.teamCode) refs.teamCodeInput.value = state.social.teamCode;
  if (state.report.webhookUrl) refs.reportWebhookInput.value = state.report.webhookUrl;
  refs.reportEnableToggle.checked = Boolean(state.report.enabled);
  if (state.meta.syncCode) {
    loadReportConfig().catch(() => {});
  }
}

function initTemplateSelectors() {
  const packs = getTemplatePacks();
  refs.marketTemplateSelect.innerHTML = packs.map((pack) => `<option value="${pack.id}">${escapeHtml(pack.name)}</option>`).join('');
  refs.roadmapTemplateSelect.innerHTML = refs.marketTemplateSelect.innerHTML;

  const selected = state.growth.roadmapTemplate || packs[0]?.id;
  if (selected) {
    refs.marketTemplateSelect.value = selected;
    refs.roadmapTemplateSelect.value = selected;
    const pack = getTemplateById(selected);
    refs.marketTemplateDesc.textContent = pack.summary;
  }

  refs.marketTemplateSelect.addEventListener('change', () => {
    const pack = getTemplateById(refs.marketTemplateSelect.value);
    refs.marketTemplateDesc.textContent = pack.summary;
    refs.roadmapTemplateSelect.value = pack.id;
    state.growth.roadmapTemplate = pack.id;
    saveState();
  });
}

function initWellbeingSelectors() {
  const options = [1, 2, 3, 4, 5]
    .map((n) => `<option value="${n}">${n} 分</option>`)
    .join('');
  refs.moodBefore.innerHTML = options;
  refs.energyBefore.innerHTML = options;
  refs.moodAfter.innerHTML = options;
  refs.energyAfter.innerHTML = options;
  refs.moodBefore.value = String(state.wellbeing.moodBefore || 3);
  refs.energyBefore.value = String(state.wellbeing.energyBefore || 3);
  refs.moodAfter.value = String(state.wellbeing.moodAfter || 4);
  refs.energyAfter.value = String(state.wellbeing.energyAfter || 4);
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

  const adaptiveXp = computeAdaptiveXp(task, state, difficultyMap, today);
  const taskXp = adaptiveXp.totalXp;
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
    baseXp: adaptiveXp.baseXp,
    bonusXp: adaptiveXp.bonusXp,
    difficulty: task.difficulty,
    title: task.title,
    completedAt: nowIso,
  });

  const currentHour = new Date().getHours();
  state.wellbeing.logs.unshift({
    date: nowIso,
    taskId,
    hour: currentHour,
    moodBefore: Number(state.wellbeing.moodBefore || 3),
    energyBefore: Number(state.wellbeing.energyBefore || 3),
    moodAfter: Number(state.wellbeing.moodAfter || 4),
    energyAfter: Number(state.wellbeing.energyAfter || 4),
  });
  state.wellbeing.logs = state.wellbeing.logs.slice(0, 240);

  const pointGain = task.difficulty === 'hard' ? 2 : 1;
  state.rewards.points += pointGain;

  if (adaptiveXp.bonusXp > 0) {
    state.growth.lastRecoveryAt = nowIso;
    trackEvent('adaptive_xp_bonus', { taskId, bonusXp: adaptiveXp.bonusXp, reasons: adaptiveXp.bonusReasons });
  }

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

  if (state.growth.roadmap?.items) {
    const todayRoadmap = state.growth.roadmap.items.find((item) => item.date === today && item.taskId === taskId);
    if (todayRoadmap) todayRoadmap.done = true;
  }

  state.taskLogs = state.taskLogs.slice(0, MAX_TASK_LOGS);
  const challengeStatus = computeWeeklyChallengeProgress(state, today);
  trackEvent('complete_task', {
    taskId,
    nodeId: task.nodeId,
    source,
    baseXp: adaptiveXp.baseXp,
    bonusXp: adaptiveXp.bonusXp,
    challengeProgress: `${challengeStatus.progress}/${challengeStatus.target}`,
  });
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
  if (adaptiveXp.bonusXp > 0) {
    parts.push(`动态加成 +${adaptiveXp.bonusXp}`);
  }
  if (levelUps > 0) parts.push(`升级 +${levelUps}`);
  if (streak.bonus > 0) parts.push(`连击奖励 +${STREAK_BONUS_XP} XP`);
  parts.push(`奖励积分 +${pointGain}`);
  showToast(parts.join(' ｜ '));

  if (state.social.teamCode && state.social.memberId) {
    syncTeamProgress().catch(() => {});
  }
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
  ensureWeeklyChallenge(state);
  ensureFeatureState();
  registerPageOpen();
  trackEvent('reset_data');
  saveState();
  renderAll();
  refs.onboardingModal.classList.remove('hidden');
  trackEvent('onboarding_start');
  refs.startOnboardingBtn.focus();
  showToast('已恢复到初始状态。');
}

function renderAll() {
  ensureSelectedNode(state);
  renderStats();
  renderNodeSelectors();
  renderTree();
  renderTasks();
  renderDailyCard();
  renderRoadmap();
  renderRescuePanel();
  renderWellbeingPanel();
  renderWeeklyChallenge();
  renderWeeklyReport();
  renderGrowthVisuals();
  renderReflections();
  renderRewards();
  renderTeamPanel();
  renderReportPanel();
  renderBadgePanel();
  renderForecastPanel();
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
  const daily = getDailyTaskRecommendation(state, difficultyMap, MAX_NODE_LEVEL);

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

function ensureRoadmapState() {
  const templateId = state.growth.roadmapTemplate || refs.roadmapTemplateSelect.value || 'procrastination-recovery';
  if (!state.growth.roadmap || state.growth.roadmap.templateId !== templateId) {
    state.growth.roadmap = generateRoadmap(state, templateId, 30);
  }

  const doneTaskIds = new Set(
    state.taskLogs
      .filter((log) => log.kind === 'task')
      .map((log) => `${log.date}:${log.taskId}`),
  );
  for (const item of state.growth.roadmap.items) {
    item.done = doneTaskIds.has(`${item.date}:${item.taskId}`);
  }
}

function regenerateRoadmap() {
  const templateId = refs.roadmapTemplateSelect.value || state.growth.roadmapTemplate || 'procrastination-recovery';
  state.growth.roadmapTemplate = templateId;
  state.growth.roadmap = generateRoadmap(state, templateId, 30);
  trackEvent('roadmap_regenerate', { templateId });
  saveState();
  renderRoadmap();
  showToast('30 天路线图已更新。');
}

function renderRoadmap() {
  ensureRoadmapState();
  const today = getDateKey();
  const items = state.growth.roadmap.items.slice(0, 10);

  refs.roadmapList.innerHTML = items
    .map((item) => {
      const cls = item.done ? 'roadmap-done' : item.date < today ? 'roadmap-pending' : '';
      const label = item.date === today ? '（今天）' : '';
      return `<li class="${cls}">Day ${item.day} ${escapeHtml(label)} · ${escapeHtml(item.title)} · ${
        item.done ? '已完成' : '待完成'
      }</li>`;
    })
    .join('');
}

function getRescueGapDays() {
  const today = getDateKey();
  const latestTask = state.taskLogs.find((log) => log.kind === 'task');
  if (!latestTask) return 0;
  return Math.max(0, dateDistance(latestTask.date, today) - 1);
}

function renderRescuePanel() {
  const gap = getRescueGapDays();
  const doneToday = state.taskLogs.some((log) => log.kind === 'task' && log.date === getDateKey());
  const available = gap >= 1 && !doneToday;

  refs.completeRescueBtn.disabled = !available;
  refs.rescueHint.textContent = available
    ? `你已经中断 ${gap} 天，先做保底任务快速恢复。`
    : '当前无需保底任务，继续正常节奏即可。';
}

function completeRescueTask() {
  if (refs.completeRescueBtn.disabled) return;

  const today = getDateKey();
  const nodeId = state.selectedNodeId || state.nodes[0]?.id;
  if (!nodeId) return;

  const rescueXp = 8;
  applyXp(nodeId, rescueXp);
  state.taskLogs.unshift({
    id: makeId('log'),
    kind: 'rescue',
    date: today,
    taskId: 'rescue-min-task',
    nodeId,
    xp: rescueXp,
    title: '2 分钟保底任务',
    completedAt: new Date().toISOString(),
  });
  state.taskLogs = state.taskLogs.slice(0, MAX_TASK_LOGS);
  state.rewards.points += 1;
  trackEvent('complete_rescue_task', { nodeId, rescueXp, gapDays: getRescueGapDays() });
  saveState();
  renderAll();
  showToast(`保底任务完成 +${rescueXp} XP`);
}

function renderWellbeingPanel() {
  const logs = state.wellbeing.logs.slice(0, 20);
  if (!logs.length) {
    refs.wellbeingHint.textContent = '记录后可看到你的状态提升趋势。';
    return;
  }

  const avgDeltaMood =
    logs.reduce((sum, item) => sum + (Number(item.moodAfter || 0) - Number(item.moodBefore || 0)), 0) / logs.length;
  const avgDeltaEnergy =
    logs.reduce((sum, item) => sum + (Number(item.energyAfter || 0) - Number(item.energyBefore || 0)), 0) / logs.length;
  refs.wellbeingHint.textContent = `最近 ${logs.length} 次：情绪变化 ${avgDeltaMood.toFixed(2)}，精力变化 ${avgDeltaEnergy.toFixed(2)}。`;
}

function generateAiAdvice() {
  const text = refs.reflectionInput.value.trim() || state.reflections[0]?.text || '';
  if (!text) {
    showToast('先输入或保存一条复盘。');
    return;
  }

  const lower = text.toLowerCase();
  let cause = '节奏不稳定，动作颗粒度可能偏大。';
  let action = '明天先做一个 5 分钟最小动作，再决定是否继续。';

  if (/拖延|躲着|不想/.test(text)) {
    cause = '你在任务启动阶段阻力过高。';
    action = '明天把任务切成 2 分钟起步动作，并设置开始倒计时。';
  } else if (/分心|打断|消息|手机/.test(text)) {
    cause = '外部干扰影响了专注持续时间。';
    action = '明天开始前先关闭 2 个通知，安排 25 分钟专注块。';
  } else if (/焦虑|害怕|担心/.test(text) || lower.includes('anxiety')) {
    cause = '对结果压力过大，导致执行迟缓。';
    action = '明天只承诺完成“最小可交付版本”，不要追求一步到位。';
  } else if (/累|困|没精神/.test(text)) {
    cause = '精力资源不足是主要约束。';
    action = '明天先选中低强度任务，并把最重要动作放在精力高峰时段。';
  }

  refs.aiAdviceOutput.textContent = `原因判断：${cause} 明日动作：${action}`;
  state.growth.lastAiAdviceAt = new Date().toISOString();
  trackEvent('ai_reflection_advice', { cause, action });
  saveState();
}

function importMarketTemplate() {
  const templateId = refs.marketTemplateSelect.value;
  const pack = importTemplatePack(state, templateId, makeId);
  state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
  state.growth.roadmapTemplate = templateId;
  state.growth.roadmap = generateRoadmap(state, templateId, 30);
  trackEvent('import_template_pack', { templateId: pack.id });
  saveState();
  renderAll();
  showToast(`已导入模板：${pack.name}`);
}

function renderWeeklyReport() {
  const summary = getWeeklySummary(state);
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

function renderWeeklyChallenge() {
  const challenge = computeWeeklyChallengeProgress(state);
  refs.weeklyChallengeTitle.textContent = challenge.title;
  refs.weeklyChallengeDesc.textContent = `${challenge.description} ｜ 奖励 +${challenge.rewardXp} XP`;
  refs.weeklyChallengeProgress.textContent = `${challenge.progress} / ${challenge.target}`;
  refs.claimChallengeBtn.disabled = !challenge.claimable;
  refs.claimChallengeBtn.textContent = challenge.claimed ? '本周已领取' : challenge.claimable ? '领取挑战奖励' : '挑战进行中';
}

function renderGrowthVisuals() {
  renderHeatmap();
  renderGrowthChart();
  renderRecoveryMetrics();
}

function renderHeatmap() {
  const days = getHeatmapData(state.taskLogs);

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
  const recovery = getRecoveryMetrics(state.taskLogs);
  const lines = [
    `中断后恢复次数：<strong>${recovery.gapCount}</strong> 次`,
    `平均恢复天数：<strong>${recovery.avgRecovery}</strong> 天`,
    `最近一次任务：<strong>${recovery.lastTaskDate || '-'}</strong>`,
  ];

  refs.recoveryList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
}

async function generateShareImage() {
  const summary = getWeeklySummary(state);
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

function buildShareSnapshot() {
  const summary = getWeeklySummary(state);
  const challenge = computeWeeklyChallengeProgress(state);
  const topNodes = [summary.topA, summary.topB]
    .filter(Boolean)
    .map(([nodeId, xp]) => ({ name: getNodeById(nodeId)?.name || nodeId, xp }));

  return {
    generatedAt: new Date().toISOString(),
    accountLevel: 1 + Math.floor(state.totalXp / 180),
    streak: state.streak,
    weekXp: summary.weekXp,
    finishedCount: summary.finishedCount,
    topNodes,
    weeklyChallenge: {
      title: challenge.title,
      progress: challenge.progress,
      target: challenge.target,
    },
    message: state.reflections[0]?.text || '每天一个最小动作，持续进步。',
  };
}

async function publishShareLink() {
  try {
    const result = await apiClient.createShare(buildShareSnapshot());
    refs.shareLinkOutput.value = result.url || `${window.location.origin}/share/${result.shareId}`;
    await navigator.clipboard?.writeText(refs.shareLinkOutput.value).catch(() => {});
    trackEvent('publish_share_link', { shareId: result.shareId || null });
    saveState();
    showToast('分享链接已生成，已尝试复制到剪贴板。');
  } catch (error) {
    showToast(`生成分享链接失败：${error.message}`);
  }
}

function claimWeeklyChallenge() {
  const challenge = computeWeeklyChallengeProgress(state);
  if (!challenge.claimable) {
    showToast('挑战进度还未达标。');
    return;
  }

  const targetNodeId = state.selectedNodeId || state.nodes[0]?.id;
  if (!targetNodeId) return;

  applyXp(targetNodeId, challenge.rewardXp);
  state.taskLogs.unshift({
    id: makeId('log'),
    kind: 'bonus',
    date: getDateKey(),
    taskId: 'weekly-challenge',
    nodeId: targetNodeId,
    xp: challenge.rewardXp,
    title: '周挑战奖励',
    completedAt: new Date().toISOString(),
  });
  state.taskLogs = state.taskLogs.slice(0, MAX_TASK_LOGS);
  state.growth.weeklyChallenge.claimed = true;
  trackEvent('weekly_challenge_claim', { rewardXp: challenge.rewardXp, targetNodeId });
  saveState();
  renderAll();
  showToast(`周挑战奖励已领取 +${challenge.rewardXp} XP`);
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

function renderRewards() {
  refs.rewardPointsText.textContent = `奖励积分：${state.rewards.points}`;
  if (!state.rewards.items.length) {
    refs.rewardList.innerHTML = '<li>还没有奖励项，先添加一个让进步更有反馈。</li>';
    return;
  }

  refs.rewardList.innerHTML = state.rewards.items
    .map((item) => {
      const canRedeem = state.rewards.points >= item.cost;
      return `<li>
        <div class="team-row">
          <span>${escapeHtml(item.name)}（${item.cost} 分）｜已兑换 ${item.redeemedCount || 0} 次</span>
          <button class="${canRedeem ? 'btn-sub' : 'btn-plain'}" data-action="redeem-reward" data-id="${item.id}" ${
        canRedeem ? '' : 'disabled'
      }>兑换</button>
        </div>
      </li>`;
    })
    .join('');

  refs.rewardList.querySelectorAll('[data-action="redeem-reward"]').forEach((btn) => {
    btn.addEventListener('click', () => redeemReward(btn.dataset.id));
  });
}

function addRewardItem() {
  const name = refs.rewardNameInput.value.trim();
  const cost = Math.max(1, Number(refs.rewardCostInput.value || 1));
  if (!name) {
    showToast('请输入奖励名称。');
    return;
  }

  state.rewards.items.push({
    id: makeId('reward'),
    name: name.slice(0, 40),
    cost,
    redeemedCount: 0,
  });
  refs.rewardNameInput.value = '';
  trackEvent('add_reward_item', { cost });
  saveState();
  renderRewards();
  showToast('奖励项已添加。');
}

function redeemReward(rewardId) {
  const reward = state.rewards.items.find((item) => item.id === rewardId);
  if (!reward) return;
  if (state.rewards.points < reward.cost) {
    showToast('积分不足，先完成任务赚积分。');
    return;
  }

  state.rewards.points -= reward.cost;
  reward.redeemedCount = (reward.redeemedCount || 0) + 1;
  state.rewards.history.unshift({
    id: makeId('reward-history'),
    rewardId,
    name: reward.name,
    action: 'redeem',
    date: new Date().toISOString(),
    cost: reward.cost,
  });
  state.rewards.history = state.rewards.history.slice(0, 120);
  trackEvent('redeem_reward', { rewardId, cost: reward.cost });
  saveState();
  renderRewards();
  showToast(`已兑换：${reward.name}`);
}

function renderTeamPanel() {
  const hasTeam = Boolean(state.social.teamCode);
  if (!hasTeam) {
    refs.teamMembersList.innerHTML = '<li>未加入队伍，创建或加入后可共享进度。</li>';
    refs.teamCheersList.innerHTML = '<li>队友打气消息会显示在这里。</li>';
    return;
  }

  const teamCode = state.social.teamCode;
  const members = state.social.members || [];
  refs.teamCodeInput.value = teamCode;
  refs.teamAliasInput.value = state.social.alias || '';

  if (!members.length) {
    refs.teamMembersList.innerHTML = '<li>正在同步队伍信息...</li>';
  } else {
    refs.teamMembersList.innerHTML = members
      .map((member) => {
        const progress = state.social.progress[member.memberId] || {};
        const mine = member.memberId === state.social.memberId ? '（我）' : '';
        return `<li>
          <div class="team-row">
            <strong>${escapeHtml(member.alias)}${mine}</strong>
            <span>${progress.weekXp || 0} XP ｜ 连续 ${progress.streak || 0} 天 ｜ 挑战 ${escapeHtml(
          progress.challengeProgress || '0/0',
        )}</span>
          </div>
        </li>`;
      })
      .join('');
  }

  const cheers = state.social.cheers || [];
  refs.teamCheersList.innerHTML = cheers.length
    ? cheers
        .slice(0, 8)
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.fromAlias || '队友')}</strong>：${escapeHtml(item.message)}<br/><span>${escapeHtml(
              item.createdAt || '',
            )}</span></li>`,
        )
        .join('')
    : '<li>还没有打气消息，先发一句鼓励吧。</li>';
}

function renderReportPanel() {
  refs.reportWebhookInput.value = state.report.webhookUrl || '';
  refs.reportEnableToggle.checked = Boolean(state.report.enabled);
  refs.reportStatusText.textContent = state.report.lastStatus || '尚未配置自动发送。';
}

function computeBadges() {
  const now = getDateKey();
  const completedTasks = state.taskLogs.filter((log) => log.kind === 'task').length;
  const recovery = getRecoveryMetrics(state.taskLogs);
  const weekSummary = getWeeklySummary(state, now);
  const challenge = computeWeeklyChallengeProgress(state, now);
  const shareCount = state.analytics.events.filter((item) => item.type === 'publish_share_link').length;

  return [
    { key: 'starter', name: '起步徽章', desc: '完成首个任务', earned: completedTasks >= 1 },
    { key: 'stability', name: '稳定输出', desc: '连续进步 7 天', earned: state.streak >= 7 },
    { key: 'recovery', name: '恢复大师', desc: '中断后恢复 3 次', earned: recovery.gapCount >= 3 },
    { key: 'challenger', name: '挑战征服者', desc: '领取周挑战奖励', earned: Boolean(challenge.claimed) },
    { key: 'shipper', name: '周报发布者', desc: '生成过分享链接', earned: shareCount >= 1 },
    { key: 'sprinter', name: '冲刺达人', desc: '本周完成任务 12 次', earned: weekSummary.finishedCount >= 12 },
  ];
}

function renderBadgePanel() {
  const badges = computeBadges();
  refs.badgeList.innerHTML = badges
    .map(
      (badge) =>
        `<li class="${badge.earned ? 'badge-earned' : 'badge-locked'}"><strong>${badge.earned ? '已解锁' : '未解锁'}</strong> · ${escapeHtml(
          badge.name,
        )}：${escapeHtml(badge.desc)}</li>`,
    )
    .join('');
}

function computeForecast() {
  const today = getDateKey();
  const days = [];
  for (let i = 13; i >= 0; i -= 1) days.push(addDays(today, -i));
  const byDay = {};
  for (const day of days) byDay[day] = 0;
  for (const log of state.taskLogs) {
    if (log.kind !== 'task') continue;
    if (Object.prototype.hasOwnProperty.call(byDay, log.date)) byDay[log.date] += 1;
  }

  const values = days.map((day) => byDay[day] || 0);
  const firstHalf = values.slice(0, 7).reduce((a, b) => a + b, 0);
  const secondHalf = values.slice(7).reduce((a, b) => a + b, 0);
  const trendUp = secondHalf >= firstHalf;
  const avgDaily = values.reduce((a, b) => a + b, 0) / values.length;
  const recentZeros = values.slice(-4).filter((v) => v === 0).length;
  const risk = recentZeros >= 2 || avgDaily < 0.8 ? '高' : avgDaily < 1.3 ? '中' : '低';

  return {
    trendUp,
    avgDaily: Number(avgDaily.toFixed(2)),
    nextWeekEstimate: Math.max(1, Math.round(avgDaily * 7)),
    risk,
  };
}

function renderForecastPanel() {
  const forecast = computeForecast();
  const lines = [
    `近 14 天日均完成：<strong>${forecast.avgDaily}</strong> 次`,
    `下周预计完成：<strong>${forecast.nextWeekEstimate}</strong> 次`,
    `趋势方向：<strong>${forecast.trendUp ? '上升' : '下降'}</strong>`,
    `掉线风险：<strong>${forecast.risk}</strong>（建议提前做保底任务）`,
  ];
  refs.forecastList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
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
    ensureWeeklyChallenge(state);
    ensureFeatureState();
    state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
    ensureSelectedNode(state);
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
    await apiClient.uploadSync(syncCode, buildBackupPayload());

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
    const data = await apiClient.downloadSync(syncCode);
    if (!data?.payload) throw new Error('云端没有备份');

    state = mergeState(data.payload.state || data.payload);
    ensureWeeklyChallenge(state);
    ensureFeatureState();
    state.meta.syncCode = syncCode;
    state.nodeProgress = syncUnlockState(state.nodes, state.nodeProgress);
    ensureSelectedNode(state);
    trackEvent('cloud_download');
    saveState();
    renderAll();
    showToast('已从云端恢复数据。');
  } catch (error) {
    showToast(`云端恢复失败：${error.message}`);
  }
}

async function createTeam() {
  const alias = (refs.teamAliasInput.value || '').trim().slice(0, 18) || '我';
  try {
    const result = await apiClient.createTeam(alias);
    state.social.teamCode = result.teamCode;
    state.social.memberId = result.memberId;
    state.social.alias = alias;
    state.social.members = result.team?.members || [];
    state.social.progress = result.team?.progress || {};
    state.social.cheers = result.team?.cheers || [];
    refs.teamCodeInput.value = result.teamCode;
    trackEvent('team_create', { teamCode: result.teamCode });
    saveState();
    renderTeamPanel();
    showToast(`队伍已创建：${result.teamCode}`);
  } catch (error) {
    showToast(`创建队伍失败：${error.message}`);
  }
}

async function joinTeam() {
  const teamCode = (refs.teamCodeInput.value || '').trim().toUpperCase();
  const alias = (refs.teamAliasInput.value || '').trim().slice(0, 18) || '新伙伴';
  if (!teamCode) {
    showToast('请先输入队伍邀请码。');
    return;
  }

  try {
    const result = await apiClient.joinTeam(teamCode, alias);
    state.social.teamCode = result.teamCode;
    state.social.memberId = result.memberId;
    state.social.alias = alias;
    state.social.members = result.team?.members || [];
    state.social.progress = result.team?.progress || {};
    state.social.cheers = result.team?.cheers || [];
    trackEvent('team_join', { teamCode: result.teamCode });
    saveState();
    renderTeamPanel();
    showToast(`已加入队伍：${result.teamCode}`);
  } catch (error) {
    showToast(`加入队伍失败：${error.message}`);
  }
}

async function syncTeamProgress() {
  const teamCode = state.social.teamCode || (refs.teamCodeInput.value || '').trim().toUpperCase();
  const memberId = state.social.memberId;
  if (!teamCode || !memberId) {
    showToast('请先创建或加入队伍。');
    return;
  }

  const summary = getWeeklySummary(state);
  const challenge = computeWeeklyChallengeProgress(state);
  try {
    const updated = await apiClient.updateTeamProgress({
      teamCode,
      memberId,
      alias: (refs.teamAliasInput.value || state.social.alias || '').trim().slice(0, 18),
      weekXp: summary.weekXp,
      streak: state.streak,
      challengeProgress: `${challenge.progress}/${challenge.target}`,
    });

    state.social.teamCode = teamCode;
    state.social.alias = (refs.teamAliasInput.value || state.social.alias || '').trim().slice(0, 18);
    state.social.members = updated.team?.members || [];
    state.social.progress = updated.team?.progress || {};
    state.social.cheers = updated.team?.cheers || [];
    state.social.updatedAt = updated.team?.updatedAt || new Date().toISOString();
    trackEvent('team_sync', { teamCode });
    saveState();
    renderTeamPanel();
    showToast('队伍进度已同步。');
  } catch (error) {
    showToast(`同步队伍失败：${error.message}`);
  }
}

async function sendTeamCheer() {
  const teamCode = state.social.teamCode;
  const memberId = state.social.memberId;
  const message = refs.teamCheerInput.value.trim();
  if (!teamCode || !memberId) {
    showToast('请先创建或加入队伍。');
    return;
  }
  if (!message) {
    showToast('请输入打气内容。');
    return;
  }

  try {
    const result = await apiClient.sendTeamCheer({
      teamCode,
      fromMemberId: memberId,
      message,
    });
    refs.teamCheerInput.value = '';
    state.social.members = result.team?.members || [];
    state.social.progress = result.team?.progress || {};
    state.social.cheers = result.team?.cheers || [];
    trackEvent('team_cheer_send', { teamCode });
    saveState();
    renderTeamPanel();
    showToast('打气已发送。');
  } catch (error) {
    showToast(`发送打气失败：${error.message}`);
  }
}

async function loadReportConfig() {
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) return;
  try {
    const result = await apiClient.getReportConfig(syncCode);
    if (result?.report) {
      state.report = {
        ...state.report,
        ...result.report,
      };
      saveState();
      renderReportPanel();
    }
  } catch {
    // ignore
  }
}

async function saveReportConfig() {
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) {
    showToast('先填写同步口令，再保存周报配置。');
    return;
  }

  const webhookUrl = refs.reportWebhookInput.value.trim();
  const enabled = refs.reportEnableToggle.checked;
  try {
    const result = await apiClient.saveReportConfig(syncCode, webhookUrl, enabled);
    state.report = {
      ...state.report,
      ...(result.report || {}),
    };
    trackEvent('report_config_save', { enabled });
    saveState();
    renderReportPanel();
    showToast('周报自动发送配置已保存。');
  } catch (error) {
    showToast(`保存失败：${error.message}`);
  }
}

async function testReportSend() {
  const syncCode = refs.syncCodeInput.value.trim() || state.meta.syncCode;
  if (!syncCode) {
    showToast('先填写同步口令，再发送测试。');
    return;
  }

  try {
    const result = await apiClient.testReport(syncCode, buildShareSnapshot());
    state.report.lastStatus = result.ok ? `测试成功：${result.status}` : `测试失败：${result.status}`;
    trackEvent('report_test_send', { ok: Boolean(result.ok) });
    saveState();
    renderReportPanel();
    showToast('测试周报已发送。');
  } catch (error) {
    showToast(`测试发送失败：${error.message}`);
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

    const keyData = await apiClient.getPushPublicKey();
    const publicKey = keyData?.publicKey;
    if (!publicKey) throw new Error('公钥为空');

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await apiClient.subscribePush(syncCode, subscription);

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
    await apiClient.syncReminder(
      syncCode,
      Boolean(state.meta.reminderEnabled),
      state.meta.reminderTime,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
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
    await apiClient.pushTest(syncCode, message);
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

  const weekly = computeWeeklyLayerMetrics(state);
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

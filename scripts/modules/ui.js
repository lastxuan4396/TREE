export const refs = {
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
  roadmapTemplateSelect: document.getElementById('roadmapTemplateSelect'),
  regenerateRoadmapBtn: document.getElementById('regenerateRoadmapBtn'),
  roadmapList: document.getElementById('roadmapList'),
  rescueHint: document.getElementById('rescueHint'),
  completeRescueBtn: document.getElementById('completeRescueBtn'),
  moodBefore: document.getElementById('moodBefore'),
  energyBefore: document.getElementById('energyBefore'),
  moodAfter: document.getElementById('moodAfter'),
  energyAfter: document.getElementById('energyAfter'),
  wellbeingHint: document.getElementById('wellbeingHint'),
  reminderToggle: document.getElementById('reminderToggle'),
  reminderTime: document.getElementById('reminderTime'),
  testReminderBtn: document.getElementById('testReminderBtn'),
  addCalendarBtn: document.getElementById('addCalendarBtn'),
  enablePushBtn: document.getElementById('enablePushBtn'),
  generateShareBtn: document.getElementById('generateShareBtn'),
  publishShareBtn: document.getElementById('publishShareBtn'),
  shareLinkOutput: document.getElementById('shareLinkOutput'),
  downloadShareBtn: document.getElementById('downloadShareBtn'),
  sharePreview: document.getElementById('sharePreview'),
  heatmap: document.getElementById('heatmap'),
  nodeGrowthChart: document.getElementById('nodeGrowthChart'),
  recoveryList: document.getElementById('recoveryList'),
  weeklyChallengeTitle: document.getElementById('weeklyChallengeTitle'),
  weeklyChallengeDesc: document.getElementById('weeklyChallengeDesc'),
  weeklyChallengeProgress: document.getElementById('weeklyChallengeProgress'),
  claimChallengeBtn: document.getElementById('claimChallengeBtn'),
  aiAdviceBtn: document.getElementById('aiAdviceBtn'),
  aiAdviceOutput: document.getElementById('aiAdviceOutput'),
  newNodeName: document.getElementById('newNodeName'),
  newNodeParent: document.getElementById('newNodeParent'),
  newNodeDesc: document.getElementById('newNodeDesc'),
  addNodeBtn: document.getElementById('addNodeBtn'),
  newTaskNode: document.getElementById('newTaskNode'),
  newTaskDifficulty: document.getElementById('newTaskDifficulty'),
  newTaskTitle: document.getElementById('newTaskTitle'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  marketTemplateSelect: document.getElementById('marketTemplateSelect'),
  marketTemplateDesc: document.getElementById('marketTemplateDesc'),
  importTemplateBtn: document.getElementById('importTemplateBtn'),
  syncCodeInput: document.getElementById('syncCodeInput'),
  generateSyncCodeBtn: document.getElementById('generateSyncCodeBtn'),
  cloudUploadBtn: document.getElementById('cloudUploadBtn'),
  cloudDownloadBtn: document.getElementById('cloudDownloadBtn'),
  teamAliasInput: document.getElementById('teamAliasInput'),
  teamCodeInput: document.getElementById('teamCodeInput'),
  createTeamBtn: document.getElementById('createTeamBtn'),
  joinTeamBtn: document.getElementById('joinTeamBtn'),
  syncTeamBtn: document.getElementById('syncTeamBtn'),
  teamCheerInput: document.getElementById('teamCheerInput'),
  sendCheerBtn: document.getElementById('sendCheerBtn'),
  teamMembersList: document.getElementById('teamMembersList'),
  teamCheersList: document.getElementById('teamCheersList'),
  rewardPointsText: document.getElementById('rewardPointsText'),
  rewardNameInput: document.getElementById('rewardNameInput'),
  rewardCostInput: document.getElementById('rewardCostInput'),
  addRewardBtn: document.getElementById('addRewardBtn'),
  rewardList: document.getElementById('rewardList'),
  reportWebhookInput: document.getElementById('reportWebhookInput'),
  reportEnableToggle: document.getElementById('reportEnableToggle'),
  saveReportConfigBtn: document.getElementById('saveReportConfigBtn'),
  testReportBtn: document.getElementById('testReportBtn'),
  reportStatusText: document.getElementById('reportStatusText'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataBtn: document.getElementById('importDataBtn'),
  importFileInput: document.getElementById('importFileInput'),
  analyticsList: document.getElementById('analyticsList'),
  badgeList: document.getElementById('badgeList'),
  forecastList: document.getElementById('forecastList'),
  onboardingModal: document.getElementById('onboardingModal'),
  startOnboardingBtn: document.getElementById('startOnboardingBtn'),
  skipOnboardingBtn: document.getElementById('skipOnboardingBtn'),
  installAppBtn: document.getElementById('installAppBtn'),
};

let toastTimer = null;

export function showToast(message) {
  if (!refs.toast) return;
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 1900);
}

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function makeId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

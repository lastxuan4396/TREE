import { addDays, getDateKey } from '../core.js';

const TEMPLATE_PACKS = [
  {
    id: 'procrastination-recovery',
    name: '拖延恢复',
    summary: '低阻力开工，先恢复执行节奏。',
    nodes: [
      { name: '启动触发器', desc: '3 分钟内进入任务。', parentIndex: null },
      { name: '中断隔离', desc: '识别并隔离干扰源。', parentIndex: 0 },
      { name: '收口动作', desc: '用 5 分钟完成任务收尾。', parentIndex: 1 },
    ],
    tasks: [
      { nodeIndex: 0, title: '设置 3 分钟启动倒计时', difficulty: 'easy' },
      { nodeIndex: 0, title: '立即完成一个 2 分钟动作', difficulty: 'easy' },
      { nodeIndex: 1, title: '记录今天最强干扰源', difficulty: 'medium' },
      { nodeIndex: 2, title: '做一次 5 分钟任务收口', difficulty: 'easy' },
    ],
  },
  {
    id: 'exam-sprint',
    name: '考研冲刺',
    summary: '稳定输出 + 定期复盘。',
    nodes: [
      { name: '日题推进', desc: '每天输出高质量练习。', parentIndex: null },
      { name: '错题复盘', desc: '聚焦高频错因。', parentIndex: 0 },
      { name: '模拟冲刺', desc: '周内完成整套模拟。', parentIndex: 1 },
    ],
    tasks: [
      { nodeIndex: 0, title: '完成今日核心题组', difficulty: 'medium' },
      { nodeIndex: 1, title: '整理 3 条错因并写对策', difficulty: 'hard' },
      { nodeIndex: 2, title: '完成一段模拟并复盘', difficulty: 'hard' },
      { nodeIndex: 0, title: '复述今天知识框架 5 分钟', difficulty: 'easy' },
    ],
  },
  {
    id: 'fitness-gain',
    name: '健身增肌',
    summary: '动作质量、饮食和恢复并进。',
    nodes: [
      { name: '训练执行', desc: '稳定完成训练计划。', parentIndex: null },
      { name: '饮食管理', desc: '跟踪蛋白和总热量。', parentIndex: 0 },
      { name: '恢复优化', desc: '睡眠与拉伸保护进步。', parentIndex: 0 },
    ],
    tasks: [
      { nodeIndex: 0, title: '完成今日主训练动作', difficulty: 'medium' },
      { nodeIndex: 1, title: '记录今日蛋白摄入', difficulty: 'easy' },
      { nodeIndex: 2, title: '训练后做 8 分钟拉伸', difficulty: 'easy' },
      { nodeIndex: 0, title: '额外补一组弱项动作', difficulty: 'hard' },
    ],
  },
  {
    id: 'couple-communication',
    name: '情侣沟通',
    summary: '稳定表达需求，减少误解。',
    nodes: [
      { name: '表达需求', desc: '说清楚感受和需求。', parentIndex: null },
      { name: '倾听回应', desc: '先听懂再回应。', parentIndex: 0 },
      { name: '冲突修复', desc: '快速回到合作状态。', parentIndex: 1 },
    ],
    tasks: [
      { nodeIndex: 0, title: '用 NVC 模板说一次需求', difficulty: 'medium' },
      { nodeIndex: 1, title: '复述对方观点并确认', difficulty: 'easy' },
      { nodeIndex: 2, title: '冲突后 12 分钟修复对话', difficulty: 'hard' },
      { nodeIndex: 0, title: '说一句今天的感谢', difficulty: 'easy' },
    ],
  },
  {
    id: 'portfolio-ship',
    name: '作品集冲刺',
    summary: '高频产出、快速迭代、按周交付。',
    nodes: [
      { name: '产出推进', desc: '每天推进一个可见成果。', parentIndex: null },
      { name: '反馈迭代', desc: '持续吸收反馈并修正。', parentIndex: 0 },
      { name: '展示包装', desc: '优化叙事和呈现质量。', parentIndex: 1 },
    ],
    tasks: [
      { nodeIndex: 0, title: '交付一个可演示版本', difficulty: 'hard' },
      { nodeIndex: 1, title: '收集并落地 2 条反馈', difficulty: 'medium' },
      { nodeIndex: 2, title: '优化一个案例叙事页面', difficulty: 'medium' },
      { nodeIndex: 0, title: '完成一次 25 分钟专注修改', difficulty: 'easy' },
    ],
  },
];

export function getTemplatePacks() {
  return TEMPLATE_PACKS;
}

export function getTemplateById(templateId) {
  return TEMPLATE_PACKS.find((pack) => pack.id === templateId) || TEMPLATE_PACKS[0];
}

export function importTemplatePack(state, templateId, makeIdFn) {
  const pack = getTemplateById(templateId);
  const idMap = [];

  for (const node of pack.nodes) {
    const nodeId = makeIdFn(`tpl-node-${pack.id}`);
    const parentId = Number.isInteger(node.parentIndex) ? idMap[node.parentIndex] || null : null;
    state.nodes.push({
      id: nodeId,
      name: node.name.slice(0, 18),
      desc: node.desc.slice(0, 50),
      parentId,
      row: 1,
      col: 1,
      custom: true,
      templateId: pack.id,
    });
    state.nodeProgress[nodeId] = { level: 1, xp: 0, unlocked: !parentId };
    idMap.push(nodeId);
  }

  for (const task of pack.tasks) {
    const nodeId = idMap[task.nodeIndex];
    if (!nodeId) continue;
    state.tasks.push({
      id: makeIdFn(`tpl-task-${pack.id}`),
      nodeId,
      title: task.title.slice(0, 48),
      difficulty: task.difficulty,
      custom: true,
      templateId: pack.id,
    });
  }

  return pack;
}

export function generateRoadmap(state, templateId, days = 30) {
  const pack = getTemplateById(templateId);
  const tasks = state.tasks.filter((task) => task.templateId === pack.id || task.custom || !task.templateId);
  const today = getDateKey();

  const roadmap = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(today, i);
    const task = tasks[i % tasks.length] || state.tasks[i % state.tasks.length];
    roadmap.push({
      day: i + 1,
      date,
      templateId: pack.id,
      taskId: task?.id || '',
      nodeId: task?.nodeId || '',
      title: task?.title || `第 ${i + 1} 天最小动作`,
      difficulty: task?.difficulty || 'easy',
      done: false,
    });
  }

  return {
    templateId: pack.id,
    generatedAt: new Date().toISOString(),
    days,
    items: roadmap,
  };
}

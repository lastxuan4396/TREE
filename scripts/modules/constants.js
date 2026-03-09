export const STORAGE_KEY = 'ability-tree-upgrade-v5';
export const LEGACY_STORAGE_KEYS = ['ability-tree-upgrade-v4'];

export const MAX_TASK_LOGS = 900;
export const MAX_REFLECTIONS = 100;
export const MAX_EVENTS = 800;
export const MAX_VISITS = 140;

export const ANTI_CHEAT_CONFIG = {
  minTaskIntervalMs: 4000,
  maxTasksPerMinute: 6,
  maxTasksPerDay: 40,
};

export const difficultyMap = {
  easy: { label: '简单', xp: 10, className: 'easy' },
  medium: { label: '中等', xp: 20, className: 'medium' },
  hard: { label: '困难', xp: 35, className: 'hard' },
};

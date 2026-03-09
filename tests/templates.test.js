import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../scripts/modules/state.js';
import { generateRoadmap, getTemplateById, importTemplatePack } from '../scripts/modules/templates.js';

test('importTemplatePack should append template nodes/tasks and unlock only root', () => {
  const state = createInitialState();
  let i = 0;
  const makeId = (prefix) => `${prefix}-${++i}`;

  const beforeNodes = state.nodes.length;
  const beforeTasks = state.tasks.length;
  const pack = importTemplatePack(state, 'procrastination-recovery', makeId);

  assert.equal(pack.id, 'procrastination-recovery');
  assert.equal(state.nodes.length, beforeNodes + pack.nodes.length);
  assert.equal(state.tasks.length, beforeTasks + pack.tasks.length);

  const addedNodes = state.nodes.slice(beforeNodes);
  const root = addedNodes.find((node) => node.parentId === null);
  const child = addedNodes.find((node) => node.parentId !== null);

  assert.ok(root);
  assert.ok(child);
  assert.equal(state.nodeProgress[root.id].unlocked, true);
  assert.equal(state.nodeProgress[child.id].unlocked, false);
});

test('generateRoadmap should build expected number of roadmap items', () => {
  const state = createInitialState();
  const template = getTemplateById('exam-sprint');
  const roadmap = generateRoadmap(state, template.id, 14);

  assert.equal(roadmap.templateId, template.id);
  assert.equal(roadmap.days, 14);
  assert.equal(roadmap.items.length, 14);
  assert.equal(roadmap.items[0].day, 1);
  assert.equal(roadmap.items[13].day, 14);
  assert.equal(typeof roadmap.items[0].title, 'string');
  assert.ok(roadmap.items[0].title.length > 0);
});

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 10000;
const MAX_SYNC_CODE_LENGTH = 60;
const MAX_PAYLOAD_BYTES = 900 * 1024;
const DATA_DIR = path.join(__dirname, '.tree-data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const app = express();
app.use(express.json({ limit: '1mb' }));

const pushContact = process.env.WEB_PUSH_CONTACT || 'mailto:tree@example.com';
const hasEnvVapid = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const vapidKeys = hasEnvVapid
  ? {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    }
  : webpush.generateVAPIDKeys();

webpush.setVapidDetails(pushContact, vapidKeys.publicKey, vapidKeys.privateKey);

if (!hasEnvVapid) {
  console.warn('[TREE] Using ephemeral VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY for stable push subscriptions.');
}

const store = {
  sync: {},
  push: {},
};

let saveQueue = Promise.resolve();

function normalizeSyncCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SYNC_CODE_LENGTH);
}

function parseReminderTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function ensureTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return 'UTC';
  const candidate = timeZone.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function getLocalDateTime(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function getPushRecord(syncCode) {
  if (!store.push[syncCode]) {
    store.push[syncCode] = {
      subscriptions: [],
      reminder: {
        enabled: false,
        time: '20:30',
        timezone: 'UTC',
        lastSentDate: '',
      },
      updatedAt: '',
    };
  }

  const record = store.push[syncCode];
  if (!Array.isArray(record.subscriptions)) record.subscriptions = [];
  if (!record.reminder || typeof record.reminder !== 'object') {
    record.reminder = {
      enabled: false,
      time: '20:30',
      timezone: 'UTC',
      lastSentDate: '',
    };
  }
  return record;
}

function queueSave() {
  const snapshot = JSON.stringify(store, null, 2);
  saveQueue = saveQueue
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tempPath = `${STORE_PATH}.tmp`;
      await fs.writeFile(tempPath, snapshot, 'utf8');
      await fs.rename(tempPath, STORE_PATH);
    })
    .catch((error) => {
      console.error('[TREE] Persist store failed:', error.message);
    });

  return saveQueue;
}

async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.sync && typeof parsed.sync === 'object') {
        store.sync = parsed.sync;
      }
      if (parsed.push && typeof parsed.push === 'object') {
        store.push = parsed.push;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[TREE] Load store failed:', error.message);
    }
  }
}

async function sendPush(syncCode, payload) {
  const record = getPushRecord(syncCode);
  const staleEndpoints = new Set();
  let sent = 0;

  await Promise.all(
    record.subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        sent += 1;
      } catch (error) {
        const status = Number(error.statusCode || error.status || 0);
        if (status === 404 || status === 410) {
          staleEndpoints.add(subscription.endpoint);
          return;
        }
        console.error('[TREE] Push send failed:', error.message);
      }
    }),
  );

  if (staleEndpoints.size > 0) {
    record.subscriptions = record.subscriptions.filter((item) => !staleEndpoints.has(item.endpoint));
    record.updatedAt = new Date().toISOString();
    queueSave();
  }

  return { sent, total: record.subscriptions.length };
}

async function processReminders() {
  const now = new Date();
  let dirty = false;

  for (const [syncCode, record] of Object.entries(store.push)) {
    if (!record || typeof record !== 'object') continue;
    const reminder = record.reminder;
    if (!reminder || !reminder.enabled) continue;

    const parsedTime = parseReminderTime(reminder.time || '');
    if (!parsedTime) continue;

    const timeZone = ensureTimeZone(reminder.timezone || 'UTC');
    const local = getLocalDateTime(now, timeZone);

    if (local.hour !== parsedTime.hour || local.minute !== parsedTime.minute) continue;
    if (reminder.lastSentDate === local.dateKey) continue;

    await sendPush(syncCode, {
      title: '能力树升级提醒',
      body: '今日任务时间到：先完成一个最小动作。',
      url: '/',
      tag: 'tree-daily-reminder',
    });

    reminder.lastSentDate = local.dateKey;
    record.updatedAt = new Date().toISOString();
    dirty = true;
  }

  if (dirty) {
    queueSave();
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', async (req, res) => {
  const syncCode = normalizeSyncCode(req.body?.syncCode);
  const subscription = req.body?.subscription;

  if (!syncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!subscription || typeof subscription !== 'object' || typeof subscription.endpoint !== 'string') {
    res.status(400).json({ error: 'subscription is invalid' });
    return;
  }

  const record = getPushRecord(syncCode);
  const exists = record.subscriptions.some((item) => item.endpoint === subscription.endpoint);
  if (!exists) {
    record.subscriptions.push(subscription);
  }

  record.updatedAt = new Date().toISOString();
  await queueSave();

  res.json({ ok: true, count: record.subscriptions.length });
});

app.post('/api/reminder', async (req, res) => {
  const syncCode = normalizeSyncCode(req.body?.syncCode);
  const enabled = Boolean(req.body?.enabled);
  const parsedTime = parseReminderTime(req.body?.time || '20:30');
  const timezone = ensureTimeZone(req.body?.timezone || 'UTC');

  if (!syncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!parsedTime) {
    res.status(400).json({ error: 'time must be HH:MM' });
    return;
  }

  const record = getPushRecord(syncCode);
  record.reminder = {
    enabled,
    time: parsedTime.value,
    timezone,
    lastSentDate: enabled ? record.reminder.lastSentDate || '' : '',
  };
  record.updatedAt = new Date().toISOString();

  await queueSave();
  res.json({ ok: true, reminder: record.reminder });
});

app.post('/api/push/test', async (req, res) => {
  const syncCode = normalizeSyncCode(req.body?.syncCode);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 120) : '';

  if (!syncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const payload = {
    title: '能力树升级提醒',
    body: message || '这是 TREE 的测试提醒。',
    url: '/',
    tag: 'tree-test-reminder',
  };

  const result = await sendPush(syncCode, payload);
  res.json({ ok: true, ...result });
});

app.post('/api/sync/upload', async (req, res) => {
  const syncCode = normalizeSyncCode(req.body?.syncCode);
  const payload = req.body?.payload;

  if (!syncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'payload is required' });
    return;
  }

  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    res.status(413).json({ error: 'payload too large' });
    return;
  }

  const updatedAt = new Date().toISOString();
  store.sync[syncCode] = {
    payload,
    updatedAt,
  };

  await queueSave();
  res.json({ ok: true, updatedAt });
});

app.post('/api/sync/download', (req, res) => {
  const syncCode = normalizeSyncCode(req.body?.syncCode);

  if (!syncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const record = store.sync[syncCode];
  if (!record) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  res.json(record);
});

app.use(express.static(__dirname));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

await loadStore();

setInterval(() => {
  processReminders().catch((error) => {
    console.error('[TREE] Reminder loop failed:', error.message);
  });
}, 30 * 1000);

app.listen(PORT, () => {
  console.log(`[TREE] Server running on http://localhost:${PORT}`);
});

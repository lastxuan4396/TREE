import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import pg from 'pg';
import webpush from 'web-push';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 10000;
const MAX_SYNC_CODE_LENGTH = 60;
const MAX_PAYLOAD_BYTES = 900 * 1024;
const MAX_SHARE_SNAPSHOT_BYTES = 200 * 1024;
const FILE_DATA_DIR = path.join(__dirname, '.tree-data');
const FILE_STORE_PATH = path.join(FILE_DATA_DIR, 'store-v2.json');

const RATE_LIMITS = {
  syncUpload: { windowMs: 60 * 1000, max: 18 },
  syncDownload: { windowMs: 60 * 1000, max: 20 },
  pushSubscribe: { windowMs: 60 * 1000, max: 18 },
  reminderSync: { windowMs: 60 * 1000, max: 28 },
  pushTest: { windowMs: 60 * 1000, max: 12 },
  shareCreate: { windowMs: 60 * 1000, max: 10 },
  teamOps: { windowMs: 60 * 1000, max: 28 },
  reportOps: { windowMs: 60 * 1000, max: 18 },
};

const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 8;
const AUTH_BLOCK_MS = 20 * 60 * 1000;
const MAX_TEAM_MEMBERS = 8;
const DEV_VAPID_KEYS = {
  // Pre-generated fallback keys for local/dev use to avoid slow cold-start key generation.
  publicKey: 'BHG8cqKIE-nYBnZvdN9dfNNSQW9ed_TcKyNHt6O64ohnWvSKRrbmNsqBdz7L9IRnIY0D9nHog6Yd9MJnDpzPq7A',
  privateKey: '-9KMoLpzmSKux4az_c55GNEmMnkNY1p23i_E7M57qWY',
};

const syncCodePepper =
  process.env.SYNC_CODE_PEPPER || process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_CONTACT || 'tree-dev-pepper';
if (!process.env.SYNC_CODE_PEPPER) {
  console.warn('[TREE] SYNC_CODE_PEPPER not set. Configure it in production for stronger sync-code protection.');
}

const cronSecret = (process.env.CRON_SECRET || '').trim();

const pushContact = process.env.WEB_PUSH_CONTACT || 'mailto:tree@example.com';
const hasEnvVapid = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const vapidKeys = hasEnvVapid
  ? {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    }
  : DEV_VAPID_KEYS;

webpush.setVapidDetails(pushContact, vapidKeys.publicKey, vapidKeys.privateKey);

if (!hasEnvVapid) {
  console.warn('[TREE] Using built-in dev VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY for production stability.');
}

class FileStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.state = {
      sync: {},
      push: {},
      shares: {},
      teams: {},
      reports: {},
    };
    this.saveQueue = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.state.sync = parsed.sync && typeof parsed.sync === 'object' ? parsed.sync : {};
        this.state.push = parsed.push && typeof parsed.push === 'object' ? parsed.push : {};
        this.state.shares = parsed.shares && typeof parsed.shares === 'object' ? parsed.shares : {};
        this.state.teams = parsed.teams && typeof parsed.teams === 'object' ? parsed.teams : {};
        this.state.reports = parsed.reports && typeof parsed.reports === 'object' ? parsed.reports : {};
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[TREE] FileStore load failed:', error.message);
      }
    }
  }

  async persist() {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.saveQueue = this.saveQueue
      .then(async () => {
        await fs.mkdir(path.dirname(this.storePath), { recursive: true });
        const tempPath = `${this.storePath}.tmp`;
        await fs.writeFile(tempPath, snapshot, 'utf8');
        await fs.rename(tempPath, this.storePath);
      })
      .catch((error) => {
        console.error('[TREE] FileStore persist failed:', error.message);
      });

    return this.saveQueue;
  }

  async getSync(syncHash) {
    return this.state.sync[syncHash] || null;
  }

  async setSync(syncHash, record) {
    this.state.sync[syncHash] = record;
    await this.persist();
  }

  async getPush(syncHash) {
    return this.state.push[syncHash] || null;
  }

  async setPush(syncHash, record) {
    this.state.push[syncHash] = record;
    await this.persist();
  }

  async listPush() {
    return Object.entries(this.state.push).map(([syncHash, record]) => ({ syncHash, record }));
  }

  async setShare(shareId, record) {
    this.state.shares[shareId] = record;
    await this.persist();
    return true;
  }

  async getShare(shareId) {
    return this.state.shares[shareId] || null;
  }

  async getTeam(teamCode) {
    return this.state.teams[teamCode] || null;
  }

  async setTeam(teamCode, record) {
    this.state.teams[teamCode] = record;
    await this.persist();
    return true;
  }

  async setTeamIfMissing(teamCode, record) {
    if (this.state.teams[teamCode]) return false;
    this.state.teams[teamCode] = record;
    await this.persist();
    return true;
  }

  async getReport(syncHash) {
    return this.state.reports[syncHash] || null;
  }

  async setReport(syncHash, record) {
    this.state.reports[syncHash] = record;
    await this.persist();
    return true;
  }

  async listReports() {
    return Object.entries(this.state.reports).map(([syncHash, record]) => ({ syncHash, record }));
  }
}

class PostgresStore {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 8000,
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sync_records (
        sync_hash TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS push_records (
        sync_hash TEXT PRIMARY KEY,
        subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
        reminder JSONB NOT NULL DEFAULT '{"enabled":false,"time":"20:30","timezone":"UTC","lastSentDate":""}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS share_snapshots (
        share_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS team_records (
        team_code TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS report_subscriptions (
        sync_hash TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_share_snapshots_created_at ON share_snapshots (created_at DESC);
    `);
  }

  async getSync(syncHash) {
    const result = await this.pool.query('SELECT payload, updated_at FROM sync_records WHERE sync_hash = $1', [syncHash]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      payload: row.payload,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    };
  }

  async setSync(syncHash, record) {
    await this.pool.query(
      `
        INSERT INTO sync_records (sync_hash, payload, updated_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (sync_hash)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
      `,
      [syncHash, JSON.stringify(record.payload), record.updatedAt],
    );
  }

  async getPush(syncHash) {
    const result = await this.pool.query(
      'SELECT subscriptions, reminder, updated_at FROM push_records WHERE sync_hash = $1',
      [syncHash],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : [],
      reminder: row.reminder && typeof row.reminder === 'object' ? row.reminder : null,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    };
  }

  async setPush(syncHash, record) {
    await this.pool.query(
      `
        INSERT INTO push_records (sync_hash, subscriptions, reminder, updated_at)
        VALUES ($1, $2::jsonb, $3::jsonb, $4)
        ON CONFLICT (sync_hash)
        DO UPDATE SET
          subscriptions = EXCLUDED.subscriptions,
          reminder = EXCLUDED.reminder,
          updated_at = EXCLUDED.updated_at
      `,
      [syncHash, JSON.stringify(record.subscriptions), JSON.stringify(record.reminder), record.updatedAt],
    );
  }

  async listPush() {
    const result = await this.pool.query('SELECT sync_hash, subscriptions, reminder, updated_at FROM push_records');
    return result.rows.map((row) => ({
      syncHash: row.sync_hash,
      record: {
        subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : [],
        reminder: row.reminder && typeof row.reminder === 'object' ? row.reminder : null,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
      },
    }));
  }

  async setShare(shareId, record) {
    const result = await this.pool.query(
      `
        INSERT INTO share_snapshots (share_id, data, created_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT DO NOTHING
        RETURNING share_id
      `,
      [shareId, JSON.stringify(record), record.createdAt],
    );
    return result.rowCount > 0;
  }

  async getShare(shareId) {
    const result = await this.pool.query('SELECT data, created_at FROM share_snapshots WHERE share_id = $1', [shareId]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const data = row.data && typeof row.data === 'object' ? row.data : {};
    return {
      ...data,
      createdAt:
        data.createdAt || (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')),
    };
  }

  async getTeam(teamCode) {
    const result = await this.pool.query('SELECT data, updated_at FROM team_records WHERE team_code = $1', [teamCode]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const data = row.data && typeof row.data === 'object' ? row.data : {};
    return {
      ...data,
      updatedAt:
        data.updatedAt || (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')),
    };
  }

  async setTeam(teamCode, record) {
    await this.pool.query(
      `
        INSERT INTO team_records (team_code, data, updated_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (team_code)
        DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
      `,
      [teamCode, JSON.stringify(record), record.updatedAt || new Date().toISOString()],
    );
    return true;
  }

  async setTeamIfMissing(teamCode, record) {
    const result = await this.pool.query(
      `
        INSERT INTO team_records (team_code, data, updated_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT DO NOTHING
        RETURNING team_code
      `,
      [teamCode, JSON.stringify(record), record.updatedAt || new Date().toISOString()],
    );
    return result.rowCount > 0;
  }

  async getReport(syncHash) {
    const result = await this.pool.query('SELECT data, updated_at FROM report_subscriptions WHERE sync_hash = $1', [syncHash]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const data = row.data && typeof row.data === 'object' ? row.data : {};
    return {
      ...data,
      updatedAt:
        data.updatedAt || (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')),
    };
  }

  async setReport(syncHash, record) {
    await this.pool.query(
      `
        INSERT INTO report_subscriptions (sync_hash, data, updated_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (sync_hash)
        DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
      `,
      [syncHash, JSON.stringify(record), record.updatedAt || new Date().toISOString()],
    );
    return true;
  }

  async listReports() {
    const result = await this.pool.query('SELECT sync_hash, data, updated_at FROM report_subscriptions');
    return result.rows.map((row) => ({
      syncHash: row.sync_hash,
      record: {
        ...(row.data && typeof row.data === 'object' ? row.data : {}),
        updatedAt:
          row.data?.updatedAt || (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')),
      },
    }));
  }
}

function normalizeSyncCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().slice(0, MAX_SYNC_CODE_LENGTH);
}

function hashSyncCode(normalizedSyncCode) {
  return createHmac('sha256', syncCodePepper).update(normalizedSyncCode).digest('hex');
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

function defaultReminder() {
  return {
    enabled: false,
    time: '20:30',
    timezone: 'UTC',
    lastSentDate: '',
  };
}

function normalizePushRecord(record) {
  const normalized = {
    subscriptions: Array.isArray(record?.subscriptions) ? record.subscriptions.filter((item) => item && item.endpoint) : [],
    reminder: {
      ...defaultReminder(),
      ...(record?.reminder && typeof record.reminder === 'object' ? record.reminder : {}),
    },
    updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : '',
  };

  const parsed = parseReminderTime(normalized.reminder.time);
  normalized.reminder.time = parsed ? parsed.value : '20:30';
  normalized.reminder.timezone = ensureTimeZone(normalized.reminder.timezone);
  normalized.reminder.enabled = Boolean(normalized.reminder.enabled);
  normalized.reminder.lastSentDate = typeof normalized.reminder.lastSentDate === 'string' ? normalized.reminder.lastSentDate : '';
  return normalized;
}

const requestBuckets = new Map();
const authFailures = new Map();

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function consumeBucket(bucketKey, limit, windowMs) {
  const now = Date.now();
  const existing = requestBuckets.get(bucketKey) || [];
  const recent = existing.filter((ts) => now - ts < windowMs);
  if (recent.length >= limit) {
    requestBuckets.set(bucketKey, recent);
    return false;
  }
  recent.push(now);
  requestBuckets.set(bucketKey, recent);
  return true;
}

function enforceRateLimit(req, res, scope, config) {
  const ip = getClientKey(req);
  const ok = consumeBucket(`${scope}:${ip}`, config.max, config.windowMs);
  if (!ok) {
    res.status(429).json({ error: 'Too many requests, please try again later.' });
    return false;
  }
  return true;
}

function getFailureRecord(ip) {
  if (!authFailures.has(ip)) {
    authFailures.set(ip, {
      events: [],
      blockedUntil: 0,
    });
  }
  return authFailures.get(ip);
}

function isBlocked(ip) {
  const record = getFailureRecord(ip);
  return Date.now() < record.blockedUntil;
}

function registerAuthFailure(ip) {
  const now = Date.now();
  const record = getFailureRecord(ip);
  record.events = record.events.filter((ts) => now - ts < AUTH_FAILURE_WINDOW_MS);
  record.events.push(now);
  if (record.events.length >= AUTH_FAILURE_LIMIT) {
    record.blockedUntil = now + AUTH_BLOCK_MS;
    record.events = [];
  }
}

function clearAuthFailures(ip) {
  authFailures.delete(ip);
}

function parseJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function sanitizeShareId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function createShareId() {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

function sanitizeAlias(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 18);
}

function sanitizeTeamCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function createTeamCode() {
  const raw = randomUUID().replaceAll('-', '').toUpperCase();
  return `TR${raw.slice(0, 6)}`;
}

function createMemberId() {
  return `m_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function defaultTeamRecord(teamCode) {
  return {
    teamCode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [],
    progress: {},
    cheers: [],
  };
}

function normalizeTeamRecord(teamCode, source) {
  const record = {
    ...defaultTeamRecord(teamCode),
    ...(source && typeof source === 'object' ? source : {}),
  };

  record.teamCode = sanitizeTeamCode(record.teamCode || teamCode);
  record.members = Array.isArray(record.members)
    ? record.members
        .filter((item) => item && typeof item.memberId === 'string')
        .slice(0, MAX_TEAM_MEMBERS)
        .map((item) => ({
          memberId: String(item.memberId).slice(0, 32),
          alias: sanitizeAlias(item.alias || '成员') || '成员',
          joinedAt: typeof item.joinedAt === 'string' ? item.joinedAt : '',
        }))
    : [];

  if (!record.progress || typeof record.progress !== 'object') {
    record.progress = {};
  }

  record.progress = Object.fromEntries(
    Object.entries(record.progress)
      .slice(0, 32)
      .map(([memberId, item]) => [
        String(memberId).slice(0, 32),
        {
          weekXp: Number.isFinite(Number(item?.weekXp)) ? Math.max(0, Number(item.weekXp)) : 0,
          streak: Number.isFinite(Number(item?.streak)) ? Math.max(0, Number(item.streak)) : 0,
          challengeProgress: String(item?.challengeProgress || '').slice(0, 20),
          updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : '',
        },
      ]),
  );

  record.cheers = Array.isArray(record.cheers)
    ? record.cheers
        .filter((item) => item && typeof item.message === 'string')
        .slice(-80)
        .map((item) => ({
          id: String(item.id || ''),
          fromMemberId: String(item.fromMemberId || '').slice(0, 32),
          fromAlias: sanitizeAlias(item.fromAlias || '伙伴') || '伙伴',
          toMemberId: item.toMemberId ? String(item.toMemberId).slice(0, 32) : '',
          message: String(item.message).slice(0, 60),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        }))
    : [];

  record.updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString();
  record.createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
  return record;
}

function teamResponse(record) {
  const sortedMembers = [...record.members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return {
    teamCode: record.teamCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    members: sortedMembers,
    progress: record.progress,
    cheers: [...record.cheers].slice(-20).reverse(),
  };
}

function getCurrentWeekKey(date = new Date()) {
  const local = new Date(date);
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function summarizeSyncPayload(payload) {
  const state = payload?.state || payload;
  if (!state || typeof state !== 'object') return null;

  const today = new Date();
  const weekStart = getCurrentWeekKey(today);
  const taskLogs = Array.isArray(state.taskLogs) ? state.taskLogs : [];

  let weekXp = 0;
  let finishedCount = 0;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const log of taskLogs) {
    if (!log || typeof log.date !== 'string') continue;
    if (log.date >= weekStart && log.date <= todayKey) {
      weekXp += Number(log.xp || 0);
      if (log.kind === 'task') finishedCount += 1;
    }
  }

  return {
    accountLevel: 1 + Math.floor(Number(state.totalXp || 0) / 180),
    streak: Math.max(0, Number(state.streak || 0)),
    weekXp: Math.max(0, Math.round(weekXp)),
    finishedCount: Math.max(0, finishedCount),
    generatedAt: new Date().toISOString(),
    sourceVersion: Number(state.version || 0),
  };
}

let store;

async function initStore() {
  if (process.env.DATABASE_URL) {
    const postgres = new PostgresStore(process.env.DATABASE_URL);
    try {
      await postgres.init();
      console.log('[TREE] Storage backend: postgres');
      return postgres;
    } catch (error) {
      const databaseRequired = process.env.DATABASE_REQUIRED === '1';
      console.error('[TREE] Postgres init failed:', error.message);
      if (databaseRequired) {
        throw error;
      }
      console.warn('[TREE] Falling back to file storage. Set DATABASE_REQUIRED=1 to disable fallback.');
    }
  }

  const fileStore = new FileStore(FILE_STORE_PATH);
  await fileStore.init();
  console.log('[TREE] Storage backend: file');
  return fileStore;
}

async function getPushRecord(syncHash) {
  const existing = await store.getPush(syncHash);
  return normalizePushRecord(existing || {});
}

async function savePushRecord(syncHash, record) {
  const normalized = normalizePushRecord(record);
  normalized.updatedAt = new Date().toISOString();
  await store.setPush(syncHash, normalized);
}

async function sendPush(syncHash, payload, pushRecord = null) {
  const record = pushRecord ? normalizePushRecord(pushRecord) : await getPushRecord(syncHash);
  if (!record.subscriptions.length) {
    return { sent: 0, total: 0 };
  }

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
    await savePushRecord(syncHash, record);
  }

  return { sent, total: record.subscriptions.length };
}

async function processReminders() {
  const now = new Date();
  const rows = await store.listPush();

  let checked = 0;
  let pushedUsers = 0;
  let sentNotifications = 0;

  for (const row of rows) {
    checked += 1;
    const syncHash = row.syncHash;
    const record = normalizePushRecord(row.record || {});
    if (!record.reminder.enabled) continue;

    const parsedTime = parseReminderTime(record.reminder.time);
    if (!parsedTime) continue;

    const timeZone = ensureTimeZone(record.reminder.timezone);
    const local = getLocalDateTime(now, timeZone);

    if (local.hour !== parsedTime.hour || local.minute !== parsedTime.minute) continue;
    if (record.reminder.lastSentDate === local.dateKey) continue;

    const result = await sendPush(
      syncHash,
      {
        title: '能力树升级提醒',
        body: '今日任务时间到：先完成一个最小动作。',
        url: '/',
        tag: 'tree-daily-reminder',
      },
      record,
    );

    if (result.sent > 0) {
      pushedUsers += 1;
      sentNotifications += result.sent;
    }

    record.reminder.lastSentDate = local.dateKey;
    await savePushRecord(syncHash, record);
  }

  return {
    checked,
    pushedUsers,
    sentNotifications,
    processedAt: now.toISOString(),
  };
}

function normalizeReportRecord(record) {
  return {
    enabled: Boolean(record?.enabled),
    webhookUrl: typeof record?.webhookUrl === 'string' ? record.webhookUrl.slice(0, 300) : '',
    lastSentWeekKey: typeof record?.lastSentWeekKey === 'string' ? record.lastSentWeekKey : '',
    lastSentAt: typeof record?.lastSentAt === 'string' ? record.lastSentAt : '',
    lastStatus: typeof record?.lastStatus === 'string' ? record.lastStatus : '',
    updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : '',
  };
}

async function getReportRecord(syncHash) {
  const existing = await store.getReport(syncHash);
  return normalizeReportRecord(existing || {});
}

async function saveReportRecord(syncHash, record) {
  const normalized = normalizeReportRecord(record);
  normalized.updatedAt = new Date().toISOString();
  await store.setReport(syncHash, normalized);
}

async function postReportWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'TREE-Report-Bot/1.0',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 200),
  };
}

async function processWeeklyReports(force = false) {
  const rows = await store.listReports();
  const weekKey = getCurrentWeekKey(new Date());

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    checked += 1;
    const syncHash = row.syncHash;
    const record = normalizeReportRecord(row.record || {});
    if (!record.enabled || !record.webhookUrl) continue;
    if (!force && record.lastSentWeekKey === weekKey) continue;

    const syncRecord = await store.getSync(syncHash);
    if (!syncRecord?.payload) {
      record.lastStatus = 'skip:no_sync_payload';
      await saveReportRecord(syncHash, record);
      continue;
    }

    const summary = summarizeSyncPayload(syncRecord.payload);
    if (!summary) {
      record.lastStatus = 'skip:invalid_summary';
      await saveReportRecord(syncHash, record);
      continue;
    }

    try {
      const result = await postReportWebhook(record.webhookUrl, {
        type: 'tree.weekly.report',
        weekKey,
        sentAt: new Date().toISOString(),
        summary,
      });
      if (result.ok) {
        sent += 1;
        record.lastSentWeekKey = weekKey;
        record.lastSentAt = new Date().toISOString();
        record.lastStatus = `ok:${result.status}`;
      } else {
        failed += 1;
        record.lastStatus = `fail:${result.status}`;
      }
    } catch (error) {
      failed += 1;
      record.lastStatus = `error:${String(error.message || 'unknown')}`.slice(0, 120);
    }

    await saveReportRecord(syncHash, record);
  }

  return {
    checked,
    sent,
    failed,
    weekKey,
    processedAt: new Date().toISOString(),
  };
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), backend: process.env.DATABASE_URL ? 'postgres' : 'file' });
});

app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', async (req, res) => {
  if (!enforceRateLimit(req, res, 'push_subscribe', RATE_LIMITS.pushSubscribe)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  const subscription = req.body?.subscription;

  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!subscription || typeof subscription !== 'object' || typeof subscription.endpoint !== 'string') {
    res.status(400).json({ error: 'subscription is invalid' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await getPushRecord(syncHash);

  if (!record.subscriptions.some((item) => item.endpoint === subscription.endpoint)) {
    record.subscriptions.push(subscription);
  }

  record.subscriptions = record.subscriptions.slice(-12);
  await savePushRecord(syncHash, record);

  res.json({ ok: true, count: record.subscriptions.length });
});

app.post('/api/reminder', async (req, res) => {
  if (!enforceRateLimit(req, res, 'reminder_sync', RATE_LIMITS.reminderSync)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  const enabled = Boolean(req.body?.enabled);
  const parsedTime = parseReminderTime(req.body?.time || '20:30');
  const timezone = ensureTimeZone(req.body?.timezone || 'UTC');

  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!parsedTime) {
    res.status(400).json({ error: 'time must be HH:MM' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await getPushRecord(syncHash);

  record.reminder = {
    enabled,
    time: parsedTime.value,
    timezone,
    lastSentDate: enabled ? record.reminder.lastSentDate || '' : '',
  };

  await savePushRecord(syncHash, record);
  res.json({ ok: true, reminder: record.reminder });
});

app.post('/api/push/test', async (req, res) => {
  if (!enforceRateLimit(req, res, 'push_test', RATE_LIMITS.pushTest)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 120) : '';

  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);

  const result = await sendPush(syncHash, {
    title: '能力树升级提醒',
    body: message || '这是 TREE 的测试提醒。',
    url: '/',
    tag: 'tree-test-reminder',
  });

  res.json({ ok: true, ...result });
});

app.post('/api/sync/upload', async (req, res) => {
  if (!enforceRateLimit(req, res, 'sync_upload', RATE_LIMITS.syncUpload)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  const payload = req.body?.payload;

  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'payload is required' });
    return;
  }

  const bytes = parseJsonBytes(payload);
  if (bytes > MAX_PAYLOAD_BYTES) {
    res.status(413).json({ error: 'payload too large' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const updatedAt = new Date().toISOString();

  await store.setSync(syncHash, {
    payload,
    updatedAt,
  });

  res.json({ ok: true, updatedAt });
});

app.post('/api/sync/download', async (req, res) => {
  const ip = getClientKey(req);
  if (isBlocked(ip)) {
    res.status(429).json({ error: 'Too many failed attempts. Please retry later.' });
    return;
  }

  if (!enforceRateLimit(req, res, 'sync_download', RATE_LIMITS.syncDownload)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);

  if (!normalizedSyncCode) {
    registerAuthFailure(ip);
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await store.getSync(syncHash);

  if (!record) {
    registerAuthFailure(ip);
    res.status(404).json({ error: 'sync record not found' });
    return;
  }

  clearAuthFailures(ip);
  res.json(record);
});

app.post('/api/share/create', async (req, res) => {
  if (!enforceRateLimit(req, res, 'share_create', RATE_LIMITS.shareCreate)) return;

  const snapshot = req.body?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'snapshot is required' });
    return;
  }

  const bytes = parseJsonBytes(snapshot);
  if (bytes > MAX_SHARE_SNAPSHOT_BYTES) {
    res.status(413).json({ error: 'snapshot too large' });
    return;
  }

  const createdAt = new Date().toISOString();
  let shareId = '';

  for (let i = 0; i < 5; i += 1) {
    const candidate = createShareId();
    const ok = await store.setShare(candidate, { snapshot, createdAt });
    if (ok) {
      shareId = candidate;
      break;
    }
  }

  if (!shareId) {
    res.status(500).json({ error: 'failed to create share link' });
    return;
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    ok: true,
    shareId,
    createdAt,
    url: `${origin}/share/${shareId}`,
  });
});

app.get('/api/share/:shareId', async (req, res) => {
  const shareId = sanitizeShareId(req.params.shareId);
  if (!shareId) {
    res.status(400).json({ error: 'invalid share id' });
    return;
  }

  const record = await store.getShare(shareId);
  if (!record) {
    res.status(404).json({ error: 'share not found' });
    return;
  }

  res.json({ ok: true, shareId, ...record });
});

app.post('/api/team/create', async (req, res) => {
  if (!enforceRateLimit(req, res, 'team_create', RATE_LIMITS.teamOps)) return;

  const alias = sanitizeAlias(req.body?.alias) || '我';
  let created = null;

  for (let i = 0; i < 8; i += 1) {
    const teamCode = createTeamCode();
    const memberId = createMemberId();
    const record = normalizeTeamRecord(teamCode, defaultTeamRecord(teamCode));
    record.members.push({ memberId, alias, joinedAt: new Date().toISOString() });
    record.progress[memberId] = {
      weekXp: 0,
      streak: 0,
      challengeProgress: '0/0',
      updatedAt: new Date().toISOString(),
    };
    record.updatedAt = new Date().toISOString();

    const ok = await store.setTeamIfMissing(teamCode, record);
    if (ok) {
      created = { teamCode, memberId, record };
      break;
    }
  }

  if (!created) {
    res.status(500).json({ error: 'failed to create team' });
    return;
  }

  res.json({
    ok: true,
    teamCode: created.teamCode,
    memberId: created.memberId,
    alias,
    team: teamResponse(created.record),
  });
});

app.post('/api/team/join', async (req, res) => {
  if (!enforceRateLimit(req, res, 'team_join', RATE_LIMITS.teamOps)) return;

  const teamCode = sanitizeTeamCode(req.body?.teamCode);
  const alias = sanitizeAlias(req.body?.alias) || '新伙伴';
  if (!teamCode) {
    res.status(400).json({ error: 'teamCode is required' });
    return;
  }

  const raw = await store.getTeam(teamCode);
  if (!raw) {
    res.status(404).json({ error: 'team not found' });
    return;
  }

  const record = normalizeTeamRecord(teamCode, raw);
  if (record.members.length >= MAX_TEAM_MEMBERS) {
    res.status(400).json({ error: 'team is full' });
    return;
  }

  const memberId = createMemberId();
  record.members.push({ memberId, alias, joinedAt: new Date().toISOString() });
  record.progress[memberId] = {
    weekXp: 0,
    streak: 0,
    challengeProgress: '0/0',
    updatedAt: new Date().toISOString(),
  };
  record.updatedAt = new Date().toISOString();
  await store.setTeam(teamCode, record);

  res.json({
    ok: true,
    teamCode,
    memberId,
    alias,
    team: teamResponse(record),
  });
});

app.get('/api/team/:teamCode', async (req, res) => {
  if (!enforceRateLimit(req, res, 'team_get', RATE_LIMITS.teamOps)) return;

  const teamCode = sanitizeTeamCode(req.params.teamCode);
  if (!teamCode) {
    res.status(400).json({ error: 'invalid team code' });
    return;
  }

  const raw = await store.getTeam(teamCode);
  if (!raw) {
    res.status(404).json({ error: 'team not found' });
    return;
  }

  const record = normalizeTeamRecord(teamCode, raw);
  res.json({ ok: true, team: teamResponse(record) });
});

app.post('/api/team/update', async (req, res) => {
  if (!enforceRateLimit(req, res, 'team_update', RATE_LIMITS.teamOps)) return;

  const teamCode = sanitizeTeamCode(req.body?.teamCode);
  const memberId = typeof req.body?.memberId === 'string' ? req.body.memberId.slice(0, 32) : '';
  const alias = sanitizeAlias(req.body?.alias);
  if (!teamCode || !memberId) {
    res.status(400).json({ error: 'teamCode and memberId are required' });
    return;
  }

  const raw = await store.getTeam(teamCode);
  if (!raw) {
    res.status(404).json({ error: 'team not found' });
    return;
  }

  const record = normalizeTeamRecord(teamCode, raw);
  const member = record.members.find((item) => item.memberId === memberId);
  if (!member) {
    res.status(403).json({ error: 'member not in team' });
    return;
  }
  if (alias) member.alias = alias;

  record.progress[memberId] = {
    weekXp: Number.isFinite(Number(req.body?.weekXp)) ? Math.max(0, Number(req.body.weekXp)) : 0,
    streak: Number.isFinite(Number(req.body?.streak)) ? Math.max(0, Number(req.body.streak)) : 0,
    challengeProgress: String(req.body?.challengeProgress || '').slice(0, 20),
    updatedAt: new Date().toISOString(),
  };

  record.updatedAt = new Date().toISOString();
  await store.setTeam(teamCode, record);
  res.json({ ok: true, team: teamResponse(record) });
});

app.post('/api/team/cheer', async (req, res) => {
  if (!enforceRateLimit(req, res, 'team_cheer', RATE_LIMITS.teamOps)) return;

  const teamCode = sanitizeTeamCode(req.body?.teamCode);
  const fromMemberId = typeof req.body?.fromMemberId === 'string' ? req.body.fromMemberId.slice(0, 32) : '';
  const toMemberId = typeof req.body?.toMemberId === 'string' ? req.body.toMemberId.slice(0, 32) : '';
  const message = String(req.body?.message || '').trim().slice(0, 60);

  if (!teamCode || !fromMemberId || !message) {
    res.status(400).json({ error: 'teamCode, fromMemberId and message are required' });
    return;
  }

  const raw = await store.getTeam(teamCode);
  if (!raw) {
    res.status(404).json({ error: 'team not found' });
    return;
  }

  const record = normalizeTeamRecord(teamCode, raw);
  const sender = record.members.find((item) => item.memberId === fromMemberId);
  if (!sender) {
    res.status(403).json({ error: 'member not in team' });
    return;
  }

  record.cheers.push({
    id: `cheer_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
    fromMemberId,
    fromAlias: sender.alias,
    toMemberId: toMemberId || '',
    message,
    createdAt: new Date().toISOString(),
  });
  record.cheers = record.cheers.slice(-80);
  record.updatedAt = new Date().toISOString();
  await store.setTeam(teamCode, record);

  res.json({ ok: true, team: teamResponse(record) });
});

app.post('/api/report/config', async (req, res) => {
  if (!enforceRateLimit(req, res, 'report_config', RATE_LIMITS.reportOps)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl.trim().slice(0, 300) : '';
  const enabled = Boolean(req.body?.enabled);

  if (enabled && !/^https?:\/\//i.test(webhookUrl)) {
    res.status(400).json({ error: 'webhookUrl must be http/https' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await getReportRecord(syncHash);
  record.enabled = enabled;
  record.webhookUrl = webhookUrl;
  record.lastStatus = enabled ? 'configured' : 'disabled';

  await saveReportRecord(syncHash, record);
  res.json({ ok: true, report: record });
});

app.post('/api/report/get', async (req, res) => {
  if (!enforceRateLimit(req, res, 'report_get', RATE_LIMITS.reportOps)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await getReportRecord(syncHash);
  res.json({ ok: true, report: record });
});

app.post('/api/report/test', async (req, res) => {
  if (!enforceRateLimit(req, res, 'report_test', RATE_LIMITS.reportOps)) return;

  const normalizedSyncCode = normalizeSyncCode(req.body?.syncCode);
  if (!normalizedSyncCode) {
    res.status(400).json({ error: 'syncCode is required' });
    return;
  }

  const syncHash = hashSyncCode(normalizedSyncCode);
  const record = await getReportRecord(syncHash);
  if (!record.webhookUrl) {
    res.status(400).json({ error: 'webhookUrl not configured' });
    return;
  }

  const payload = {
    type: 'tree.weekly.report.test',
    sentAt: new Date().toISOString(),
    summary: req.body?.snapshot && typeof req.body.snapshot === 'object' ? req.body.snapshot : { message: 'TREE 测试周报' },
  };

  try {
    const result = await postReportWebhook(record.webhookUrl, payload);
    record.lastStatus = result.ok ? `test_ok:${result.status}` : `test_fail:${result.status}`;
    await saveReportRecord(syncHash, record);
    res.json({ ok: result.ok, status: result.status, body: result.body });
  } catch (error) {
    record.lastStatus = `test_error:${String(error.message || 'unknown')}`.slice(0, 120);
    await saveReportRecord(syncHash, record);
    res.status(500).json({ error: `webhook error: ${error.message}` });
  }
});

async function runCronReminders(req, res) {
  if (cronSecret) {
    const secret = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
    if (secret !== cronSecret) {
      res.status(401).json({ error: 'invalid cron secret' });
      return;
    }
  }

  try {
    const result = await processReminders();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[TREE] Cron reminders failed:', error.message);
    res.status(500).json({ error: 'cron reminders failed' });
  }
}

app.post('/api/cron/reminders', runCronReminders);
app.get('/api/cron/reminders', runCronReminders);

async function runCronReports(req, res) {
  if (cronSecret) {
    const secret = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
    if (secret !== cronSecret) {
      res.status(401).json({ error: 'invalid cron secret' });
      return;
    }
  }

  const force = String(req.query.force || req.body?.force || '') === '1';
  try {
    const result = await processWeeklyReports(force);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[TREE] Cron reports failed:', error.message);
    res.status(500).json({ error: 'cron reports failed' });
  }
}

app.post('/api/cron/reports', runCronReports);
app.get('/api/cron/reports', runCronReports);

async function runCronAll(req, res) {
  if (cronSecret) {
    const secret = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
    if (secret !== cronSecret) {
      res.status(401).json({ error: 'invalid cron secret' });
      return;
    }
  }

  try {
    const [reminders, reports] = await Promise.all([processReminders(), processWeeklyReports()]);
    res.json({ ok: true, reminders, reports });
  } catch (error) {
    console.error('[TREE] Cron all failed:', error.message);
    res.status(500).json({ error: 'cron all failed' });
  }
}

app.post('/api/cron/run-all', runCronAll);
app.get('/api/cron/run-all', runCronAll);

app.get('/share/:shareId', (req, res) => {
  res.sendFile(path.join(__dirname, 'share.html'));
});

app.use(express.static(__dirname));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

store = await initStore();

if (process.env.ENABLE_INTERVAL_REMINDER === '1') {
  setInterval(() => {
    processReminders().catch((error) => {
      console.error('[TREE] Reminder interval failed:', error.message);
    });
  }, 60 * 1000);
  setInterval(() => {
    processWeeklyReports().catch((error) => {
      console.error('[TREE] Weekly report interval failed:', error.message);
    });
  }, 6 * 60 * 60 * 1000);
  console.log('[TREE] Reminder interval enabled (ENABLE_INTERVAL_REMINDER=1).');
}

app.listen(PORT, () => {
  console.log(`[TREE] Server running on http://localhost:${PORT}`);
});

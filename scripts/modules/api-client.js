async function requestJson(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message = data?.error || `服务响应 ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const apiClient = {
  getPushPublicKey() {
    return requestJson('/api/push/public-key');
  },

  subscribePush(syncCode, subscription) {
    return requestJson('/api/push/subscribe', {
      method: 'POST',
      body: { syncCode, subscription },
    });
  },

  syncReminder(syncCode, enabled, time, timezone) {
    return requestJson('/api/reminder', {
      method: 'POST',
      body: { syncCode, enabled, time, timezone },
    });
  },

  pushTest(syncCode, message) {
    return requestJson('/api/push/test', {
      method: 'POST',
      body: { syncCode, message },
    });
  },

  uploadSync(syncCode, payload) {
    return requestJson('/api/sync/upload', {
      method: 'POST',
      body: { syncCode, payload },
    });
  },

  downloadSync(syncCode) {
    return requestJson('/api/sync/download', {
      method: 'POST',
      body: { syncCode },
    });
  },

  createShare(snapshot) {
    return requestJson('/api/share/create', {
      method: 'POST',
      body: { snapshot },
    });
  },
};

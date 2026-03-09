const baseUrl = (process.env.TREE_WEB_URL || '').trim().replace(/\/$/, '');
const cronSecret = (process.env.CRON_SECRET || '').trim();

if (!baseUrl) {
  console.error('[TREE] TREE_WEB_URL is required for cron trigger.');
  process.exit(1);
}

const target = `${baseUrl}/api/cron/run-all`;

try {
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {}),
    },
    body: JSON.stringify({ source: 'render-cron' }),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`[TREE] Cron trigger failed ${response.status}: ${text}`);
    process.exit(1);
  }

  console.log(`[TREE] Cron trigger ok: ${text}`);
} catch (error) {
  console.error('[TREE] Cron trigger exception:', error.message);
  process.exit(1);
}

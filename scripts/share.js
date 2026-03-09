const refs = {
  summaryText: document.getElementById('summaryText'),
  statsGrid: document.getElementById('statsGrid'),
  detailList: document.getElementById('detailList'),
};

function readShareId() {
  const pathMatch = window.location.pathname.match(/^\/share\/([a-zA-Z0-9_-]+)$/);
  if (pathMatch?.[1]) return pathMatch[1];

  const query = new URLSearchParams(window.location.search).get('id');
  return query ? query.trim() : '';
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function loadShare() {
  const shareId = readShareId();
  if (!shareId) {
    refs.summaryText.classList.add('error');
    refs.summaryText.textContent = '链接无效：缺少分享 ID。';
    return;
  }

  try {
    const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
    if (!response.ok) {
      refs.summaryText.classList.add('error');
      refs.summaryText.textContent = response.status === 404 ? '该分享不存在或已失效。' : `加载失败（${response.status}）`;
      return;
    }

    const data = await response.json();
    const snapshot = data.snapshot || {};

    refs.summaryText.classList.remove('error');
    refs.summaryText.textContent = `生成时间：${formatDate(data.createdAt || snapshot.generatedAt)}`;

    const stats = [
      ['总等级', `Lv.${snapshot.accountLevel ?? '-'}`],
      ['连续进步', `${snapshot.streak ?? '-'} 天`],
      ['本周 XP', String(snapshot.weekXp ?? '-')],
      ['本周完成', `${snapshot.finishedCount ?? '-'} 次`],
    ];

    refs.statsGrid.hidden = false;
    refs.statsGrid.innerHTML = stats
      .map(
        ([label, value]) =>
          `<article class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></article>`,
      )
      .join('');

    const topNodes = Array.isArray(snapshot.topNodes) ? snapshot.topNodes : [];
    const challenge = snapshot.weeklyChallenge;

    const details = [
      topNodes[0] ? `本周增长最多：${topNodes[0].name}（+${topNodes[0].xp} XP）` : '本周增长最多：暂无',
      topNodes[1] ? `第二增长节点：${topNodes[1].name}（+${topNodes[1].xp} XP）` : '第二增长节点：暂无',
      challenge ? `周挑战：${challenge.title}（${challenge.progress}/${challenge.target}）` : '周挑战：暂无',
      snapshot.message ? `一句话：${snapshot.message}` : '一句话：每天一个最小动作，持续进步。',
    ];

    refs.detailList.hidden = false;
    refs.detailList.innerHTML = details.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  } catch (error) {
    refs.summaryText.classList.add('error');
    refs.summaryText.textContent = `网络错误：${error.message}`;
  }
}

loadShare();

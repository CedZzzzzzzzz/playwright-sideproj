const dateSelect = document.getElementById('dateSelect');
const refreshBtn = document.getElementById('refreshBtn');
const content = document.getElementById('content');
const stats = document.getElementById('stats');
const statNew = document.getElementById('statNew');
const statTotal = document.getElementById('statTotal');
const statGenerated = document.getElementById('statGenerated');

let dates = [];

async function init() {
  refreshBtn.addEventListener('click', () => loadReport(dateSelect.value));
  dateSelect.addEventListener('change', () => loadReport(dateSelect.value));

  try {
    dates = await fetchJson('/api/dates');
    if (!dates.length) {
      showEmpty();
      return;
    }
    populateDates(dates);
    await loadReport(dates[0]);
  } catch (err) {
    showError(err.message);
  }
}

function populateDates(list) {
  dateSelect.innerHTML = list
    .map((d) => `<option value="${d}">${formatDateLabel(d)}</option>`)
    .join('');
  dateSelect.disabled = false;
}

async function loadReport(date) {
  content.innerHTML = `
    <div class="loading">
      <div class="loading-bar"><span></span></div>
      <p>Loading ${escapeHtml(date)}…</p>
    </div>
  `;

  try {
    const data = await fetchJson(`/api/report/${date}`);
    if (data.error) {
      showError(data.error);
      return;
    }
    renderReport(data);
  } catch (err) {
    showError(err.message);
  }
}

function renderReport(data) {
  statNew.textContent = data.newCount ?? 0;
  statTotal.textContent = data.platformCount ?? data.platforms?.length ?? 0;
  statGenerated.textContent = formatGenerated(data.generatedAt);
  stats.hidden = false;

  const platforms = data.platforms || [];
  const cards = platforms.map((p, i) => renderCard(p, i + 1)).join('');
  content.innerHTML = `<div class="platform-grid">${cards}</div>`;
}

function renderCard(p, position) {
  const isNew = p.hasNewPatch || p.status === 'new';
  const impact = (p.significance || 'low').toLowerCase();
  const classes = ['platform-card'];
  if (isNew) classes.push('is-new');
  if (p.error) classes.push('has-error');

  const pos = String(position).padStart(2, '0');

  const statusBadge = isNew
    ? '<span class="badge badge-new">New</span>'
    : '<span class="badge badge-steady">Steady</span>';

  const impactBadge = `<span class="badge badge-impact ${impact}">${impact}</span>`;

  const sectorDots = ['high', 'medium', 'low']
    .map((level) => `<span class="sector-dot ${level === impact ? level : ''}"></span>`)
    .join('');

  const sentences =
    p.sentences?.length > 0
      ? `<ul class="updates">${p.sentences
          .map((s, i) => `<li data-lap="S${i + 1}">${escapeHtml(s)}</li>`)
          .join('')}</ul>`
      : '';

  const body = p.error
    ? `<p class="card-error">${escapeHtml(p.error)}</p>`
    : `
      <div class="card-release">
        <p class="latest-label">Latest release</p>
        <p class="latest-title">${escapeHtml(p.latestTitle || 'See changelog')}</p>
      </div>
      ${sentences}
    `;

  const link = p.url
    ? `<a class="card-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Changelog</a>`
    : '';

  return `
    <article class="${classes.join(' ')}">
      <div class="card-rail">
        <span class="card-pos">${pos}</span>
        <div class="sector-dots" title="Impact: ${impact}">${sectorDots}</div>
      </div>
      <div class="card-body">
        <div class="card-top">
          <div>
            <h2 class="card-title">${escapeHtml(p.platform)}</h2>
            ${p.label ? `<p class="card-meta">${escapeHtml(p.label)}</p>` : ''}
          </div>
          <div class="badges">${statusBadge}${impactBadge}</div>
        </div>
        ${body}
        ${link}
      </div>
    </article>
  `;
}

function showEmpty() {
  stats.hidden = true;
  dateSelect.innerHTML = '<option>No reports</option>';
  dateSelect.disabled = true;
  content.innerHTML = `
    <div class="empty">
      <h2>No reports yet</h2>
      <p>Run the monitor to generate your first digest.</p>
      <p><code>docker compose exec monitor node src/index.js --now</code></p>
    </div>
  `;
}

function showError(message) {
  stats.hidden = true;
  content.innerHTML = `
    <div class="error-state">
      <h2>Could not load report</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function formatDateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatGenerated(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();

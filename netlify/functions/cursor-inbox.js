/**
 * Remote Cursor inbox: ChatGPT (or a phone form) posts a prompt here, and this
 * function launches a Cursor cloud agent against the repo. The agent runs on
 * Cursor's servers, so your laptop can be closed.
 *
 * POST /.netlify/functions/cursor-inbox
 * GET  /.netlify/functions/cursor-inbox          → phone form
 * GET  /.netlify/functions/cursor-inbox?list=1   → recent agents (JSON)
 *
 * Netlify env vars:
 *   CURSOR_API_KEY          required  Dashboard → API Keys
 *   CURSOR_INBOX_SECRET     required  shared secret for ChatGPT / the form
 *   CURSOR_DEFAULT_REPO     optional  default https://github.com/emoney2/machine-scheduler
 *   CURSOR_DEFAULT_BRANCH   optional  default master
 */

const crypto = require('crypto');

const CURSOR_API = 'https://api.cursor.com/v1/agents';
const DEFAULT_REPO = 'https://github.com/emoney2/machine-scheduler';
const DEFAULT_BRANCH = 'master';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Inbox-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function secretsEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function header(event, name) {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return '';
}

function providedSecret(event, body) {
  const inboxHeader = header(event, 'x-inbox-key');
  if (inboxHeader) return inboxHeader.trim();

  const auth = header(event, 'authorization').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  if (/^apikey\s+/i.test(auth)) return auth.replace(/^apikey\s+/i, '').trim();

  const query = event.queryStringParameters || {};
  if (query.key) return String(query.key).trim();
  if (body && body.secret) return String(body.secret).trim();
  return '';
}

function isAuthorized(event, body) {
  const expected = process.env.CURSOR_INBOX_SECRET;
  if (!expected) return false;
  return secretsEqual(providedSecret(event, body), expected);
}

function parseBody(event) {
  const raw = event.body || '';
  if (!raw) return {};
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  const contentType = header(event, 'content-type');
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { prompt: text };
  }
}

function extractPrompt(body) {
  const value =
    body.prompt ||
    body.text ||
    body.message ||
    body.instruction ||
    body.request ||
    '';
  return String(value).trim();
}

function normalizeRepo(input) {
  const raw = String(input || process.env.CURSOR_DEFAULT_REPO || DEFAULT_REPO).trim();
  if (!raw) return DEFAULT_REPO;
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(raw)) {
    return raw.replace(/\.git$/i, '').replace(/\/+$/, '');
  }
  if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    return `https://github.com/${raw}`;
  }
  return '';
}

function wrapPrompt(text) {
  return [
    'You are implementing a request that was authored remotely and queued so it can run unattended (often drafted by voice in a car).',
    'Implement the request fully in this repository.',
    'Do not wait for a human. If something is ambiguous, make a reasonable assumption and mention it in the pull request description.',
    'When you are done, open a pull request.',
    '---',
    'REQUEST:',
    text,
  ].join('\n\n');
}

function cursorAuthHeader() {
  const apiKey = process.env.CURSOR_API_KEY;
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

async function cursorFetch(path, options) {
  const res = await fetch(path.startsWith('http') ? path : `${CURSOR_API}${path}`, {
    ...options,
    headers: {
      Authorization: cursorAuthHeader(),
      'Content-Type': 'application/json',
      ...(options && options.headers),
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

function formPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Cursor Inbox</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; font-family: ui-sans-serif, system-ui, sans-serif;
      background: #0b0f14; color: #e8eef5; padding: 24px 16px 48px;
    }
    main { max-width: 42rem; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin: 0 0 6px; }
    p.sub { color: #9aa8b8; margin: 0 0 20px; line-height: 1.4; }
    label { display: block; font-size: 0.85rem; color: #9aa8b8; margin: 14px 0 6px; }
    input, textarea, select {
      width: 100%; box-sizing: border-box; border: 1px solid #2a3542;
      background: #141b22; color: #e8eef5; border-radius: 10px; padding: 12px;
      font: inherit;
    }
    textarea { min-height: 220px; resize: vertical; }
    button {
      margin-top: 16px; width: 100%; border: 0; border-radius: 10px;
      padding: 14px; font: inherit; font-weight: 600; background: #3b82f6; color: white;
    }
    button:disabled { opacity: 0.6; }
    .card { background: #141b22; border: 1px solid #2a3542; border-radius: 12px; padding: 14px; margin-top: 16px; }
    .ok { color: #86efac; }
    .err { color: #fca5a5; }
    a { color: #93c5fd; }
    .jobs a { display: block; margin: 8px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Cursor Inbox</h1>
    <p class="sub">Paste a prompt here, or have ChatGPT send it. A cloud agent will write the code and open a pull request.</p>
    <form id="f">
      <label for="secret">Inbox secret</label>
      <input id="secret" name="secret" type="password" autocomplete="current-password" required />
      <label for="prompt">Prompt for Cursor</label>
      <textarea id="prompt" name="prompt" required placeholder="Implement this change…"></textarea>
      <label for="name">Short title (optional)</label>
      <input id="name" name="name" maxlength="100" placeholder="Fairway overlay fix" />
      <label for="repo">Repo (optional)</label>
      <input id="repo" name="repo" placeholder="emoney2/machine-scheduler" />
      <button type="submit">Send to Cursor</button>
    </form>
    <div id="out"></div>
    <div class="card jobs" id="jobs" hidden></div>
  </main>
  <script>
    const secretEl = document.getElementById('secret');
    const out = document.getElementById('out');
    const jobs = document.getElementById('jobs');
    secretEl.value = localStorage.getItem('cursorInboxSecret') || '';

    async function api(method, body, query) {
      const url = new URL(location.href);
      url.search = query || '';
      const res = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Inbox-Key': secretEl.value.trim(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    async function refreshJobs() {
      if (!secretEl.value.trim()) return;
      try {
        const data = await api('GET', null, 'list=1');
        const items = data.items || [];
        jobs.hidden = items.length === 0;
        jobs.innerHTML = '<strong>Recent agents</strong>' + items.map(function (item) {
          const href = item.url || ('https://cursor.com/agents/' + item.id);
          return '<a href="' + href + '">' + (item.name || item.id) + ' — ' + (item.status || '') + '</a>';
        }).join('');
      } catch (err) {
        jobs.hidden = true;
      }
    }

    document.getElementById('f').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      localStorage.setItem('cursorInboxSecret', secretEl.value.trim());
      out.innerHTML = '<p>Sending…</p>';
      try {
        const data = await api('POST', {
          prompt: document.getElementById('prompt').value,
          name: document.getElementById('name').value,
          repo: document.getElementById('repo').value,
        });
        out.innerHTML = '<div class="card ok">Queued. <a href="' + data.agentUrl + '">Open agent</a></div>';
        refreshJobs();
      } catch (err) {
        out.innerHTML = '<div class="card err">' + err.message + '</div>';
      }
    });

    secretEl.addEventListener('change', function () {
      localStorage.setItem('cursorInboxSecret', secretEl.value.trim());
      refreshJobs();
    });
    refreshJobs();
  </script>
</body>
</html>`;
  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}

async function listAgents() {
  const { res, data } = await cursorFetch('?limit=10', { method: 'GET' });
  if (!res.ok) {
    return json(res.status, { error: data.message || data.error || 'Could not list agents', detail: data });
  }
  return json(200, { items: data.items || [] });
}

async function launchAgent(body) {
  const prompt = extractPrompt(body);
  if (prompt.length < 20) {
    return json(400, { error: 'Prompt is too short. Send the full Cursor implementation prompt.' });
  }

  const repo = normalizeRepo(body.repo || body.repository);
  if (!repo) {
    return json(400, { error: 'Repo must be a GitHub URL or owner/name, for example emoney2/machine-scheduler.' });
  }

  const branch = String(body.branch || process.env.CURSOR_DEFAULT_BRANCH || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  const name = String(body.name || body.title || '').trim().slice(0, 100);
  const autoCreatePR = body.autoCreatePR !== false && body.auto_create_pr !== false;

  const payload = {
    prompt: { text: wrapPrompt(prompt) },
    repos: [{ url: repo, startingRef: branch }],
    autoCreatePR,
    skipReviewerRequest: true,
  };
  if (name) payload.name = name;

  const { res, data } = await cursorFetch('', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message =
      data.message ||
      data.error ||
      (typeof data.raw === 'string' && data.raw) ||
      'Cursor did not accept the agent request.';
    return json(res.status, { error: message, detail: data });
  }

  const agent = data.agent || {};
  const agentId = agent.id || '';
  const agentUrl = agent.url || (agentId ? `https://cursor.com/agents/${agentId}` : '');
  console.log('cursor-inbox launched', {
    agentId,
    name: agent.name || name,
    promptChars: prompt.length,
    repo,
  });

  return json(200, {
    ok: true,
    agentId,
    agentUrl,
    runId: data.run && data.run.id,
    status: agent.status || (data.run && data.run.status),
    message: agentUrl
      ? `Queued. Cursor is writing the code at ${agentUrl}`
      : 'Queued. Check https://cursor.com/agents for the run.',
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (!process.env.CURSOR_API_KEY) {
    return json(500, { error: 'CURSOR_API_KEY is not set on Netlify.' });
  }
  if (!process.env.CURSOR_INBOX_SECRET) {
    return json(500, { error: 'CURSOR_INBOX_SECRET is not set on Netlify.' });
  }

  const body = event.httpMethod === 'POST' ? parseBody(event) : {};
  const wantsJson =
    event.httpMethod === 'POST' ||
    (event.queryStringParameters && event.queryStringParameters.list) ||
    (header(event, 'accept') || '').includes('application/json');

  if (!isAuthorized(event, body)) {
    if (event.httpMethod === 'GET' && !wantsJson) return formPage();
    return json(401, { error: 'Missing or invalid inbox secret.' });
  }

  if (event.httpMethod === 'GET') {
    if (event.queryStringParameters && event.queryStringParameters.list) {
      return listAgents();
    }
    return formPage();
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use GET for the form or POST to send a prompt.' });
  }

  try {
    return await launchAgent(body);
  } catch (err) {
    return json(502, { error: (err && err.message) || 'Failed to reach Cursor.' });
  }
};

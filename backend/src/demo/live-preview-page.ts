/**
 * src/demo/live-preview-page.ts
 *
 * The interactive "Live System Preview" demo page (HTML/CSS/client JS) that
 * used to be embedded in app.ts. It is kept out of the composition root and
 * served only in non-production NODE_ENV (audit finding P2-03, 2026-10): the
 * page mixed demo/marketing scope into the API root and its API tester
 * registered throwaway user accounts on demand.
 */

export const LIVE_PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LifeStyle App — Live System Preview</title>
  <style>
    :root {
      --primary: #315C4C;
      --primary-light: #EBF2EE;
      --accent: #E07A5F;
      --bg: #F8F9FA;
      --surface: #FFFFFF;
      --text: #1F2937;
      --text-muted: #6B7280;
      --border: #E5E7EB;
      --success: #10B981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand h1 { font-size: 24px; color: var(--primary); font-weight: 700; }
    .brand p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: var(--primary-light);
      color: var(--primary);
      border-radius: 20px;
      font-weight: 600;
      font-size: 13px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .card h3 { font-size: 16px; color: var(--primary); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .card p { font-size: 13px; color: var(--text-muted); }
    .tester-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .tester-section h2 { font-size: 18px; margin-bottom: 12px; color: var(--primary); }
    .btn-group { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    button {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      transition: all 0.15s ease;
    }
    button:hover { background: var(--primary-light); border-color: var(--primary); color: var(--primary); }
    button.primary { background: var(--primary); color: white; border-color: var(--primary); }
    button.primary:hover { opacity: 0.9; }
    pre {
      background: #1E293B;
      color: #F8FAFC;
      padding: 16px;
      border-radius: 8px;
      font-size: 12px;
      overflow-x: auto;
      max-height: 320px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>LifeStyle App — Live System Preview</h1>
        <p>PostgreSQL 16 • Redis 7 • TypeScript Clean Architecture • Flutter Mobile Client</p>
      </div>
      <div class="status-badge">
        <span class="status-dot"></span>
        API v1.0.1 Healthy
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h3>📋 Tasks & Projects</h3>
        <p>Full task lifecycle, priorities, recurring instances, 30-day soft-deletion restore, and daily focus pinning.</p>
      </div>
      <div class="card">
        <h3>🔥 Habits & Streaks</h3>
        <p>Daily check-ins, automatic streak calculations, skip handling, and historical progress percentages.</p>
      </div>
      <div class="card">
        <h3>💰 Money & Subscriptions</h3>
        <p>Exact decimal arithmetic, drift-free anchor billing, live read-time monthly budget envelopes, and ACID audit logs.</p>
      </div>
      <div class="card">
        <h3>📅 Calendar & Agenda</h3>
        <p>Time-blocked events, conflict detection, user-timezone agenda views, and scheduled reminders.</p>
      </div>
      <div class="card">
        <h3>🎯 Goals & Milestones</h3>
        <p>Numeric and milestone goals with automatic achievement propagation upon milestone completion.</p>
      </div>
      <div class="card">
        <h3>📝 Notes & Linking</h3>
        <p>Rich notes with full-text search, tag counting, and polymorphic links to tasks, habits, and goals.</p>
      </div>
    </div>

    <div class="tester-section">
      <h2>Interactive Live API Explorer</h2>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
        Click any button below to execute a real live request against this server:
      </p>
      <div class="btn-group">
        <button class="primary" onclick="testEndpoint('/health/live', 'GET')">GET /health/live</button>
        <button onclick="testEndpoint('/health/ready', 'GET')">GET /health/ready</button>
        <button onclick="testRegister()">POST /auth/register</button>
        <button onclick="testTasks()">GET /tasks</button>
        <button onclick="testBudgets()">GET /money/budgets</button>
      </div>
      <pre id="output">Waiting for request... Click a button above to test the live API.</pre>
    </div>
  </div>

  <script>
    let authToken = null;

    async function testEndpoint(url, method = 'GET', body = null, headers = {}) {
      const output = document.getElementById('output');
      output.textContent = 'Executing request to ' + url + '...';
      const start = performance.now();
      try {
        const options = { method, headers: { ...headers } };
        if (body) {
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(body);
        }
        if (authToken) {
          options.headers['Authorization'] = 'Bearer ' + authToken;
        }
        const res = await fetch(url, options);
        const data = await res.json();
        const duration = Math.round(performance.now() - start);
        output.textContent = 'HTTP ' + res.status + ' (' + duration + ' ms)\n\n' + JSON.stringify(data, null, 2);
      } catch (err) {
        output.textContent = 'Error: ' + err.message;
      }
    }

    async function testRegister() {
      const email = 'user_' + Math.floor(Math.random() * 10000) + '@example.com';
      const output = document.getElementById('output');
      output.textContent = 'Registering new user ' + email + '...';
      try {
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: 'ValidPassword123!',
            displayName: 'Preview User',
            timezone: 'Africa/Cairo',
            defaultCurrency: 'USD'
          })
        });
        const data = await res.json();
        if (data.tokens && data.tokens.accessToken) {
          authToken = data.tokens.accessToken;
        }
        output.textContent = 'HTTP ' + res.status + ' (Registered & Authenticated)\n\n' + JSON.stringify(data, null, 2);
      } catch (err) {
        output.textContent = 'Error: ' + err.message;
      }
    }

    async function testTasks() {
      if (!authToken) {
        await testRegister();
      }
      testEndpoint('/api/v1/tasks', 'GET');
    }

    async function testBudgets() {
      if (!authToken) {
        await testRegister();
      }
      testEndpoint('/api/v1/money/budgets', 'GET');
    }
  </script>
</body>
</html>`;

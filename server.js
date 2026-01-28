import http from "http";
import os from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import logger from "./logger.js";
import { config } from "./config.js";

const ACCOUNTS_FILE = "./data/accounts.json";
const SETTINGS_FILE = "./data/settings.json";

function safeReadJson(file, defaultVal = []) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (!existsSync(file)) return defaultVal;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    logger.error(`Error parsing ${file}: ${e.message}`);
    return defaultVal;
  }
}

export let appState = {
  startTime: Date.now(),
  lastCheck: null,
  status: "idle",
  currentAccount: null,
  accounts: [],
  stats: {
    totalWeekly: 0,
    todayEarned: 0,
    commentsPerHour: 0,
    avgTaskTime: 0,
    taskHistory: [],
  },
  logs: [],
  system: {
    nextCycle: "Calculating...",
    memoryUsage: "0 MB",
    cpuUsage: "0%",
    totalAccounts: 0,
    apiStatus: {
      rep4rep: "checking",
      steam: "checking",
      db: "checking",
    },
  },
};

export function updateAppState(newState) {
  if (newState.logEntry) {
    const entry =
      typeof newState.logEntry === "string"
        ? {
            text: newState.logEntry,
            type: "info",
            time: new Date().toLocaleTimeString("en-GB"),
          }
        : {
            ...newState.logEntry,
            time: new Date().toLocaleTimeString("en-GB"),
          };

    appState.logs = [entry, ...appState.logs].slice(0, 20);
    delete newState.logEntry;
  }

  // Deep merged update to preserve references where possible
  if (newState.stats) Object.assign(appState.stats, newState.stats);
  if (newState.system) Object.assign(appState.system, newState.system);
  if (newState.accounts) appState.accounts = newState.accounts;
  if (newState.status) appState.status = newState.status;
  if (newState.currentAccount !== undefined)
    appState.currentAccount = newState.currentAccount;
}

function parsePostData(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0,
    totalTick = 0;
  cpus.forEach((core) => {
    for (const type in core.times) {
      totalTick += core.times[type];
    }
    totalIdle += core.times.idle;
  });
  return (100 - (100 * totalIdle) / totalTick).toFixed(1) + "%";
}

export function startServer() {
  const port = process.env.PORT || 1337;

  const server = http.createServer(async (req, res) => {
    // API Endpoints
    if (req.method === "POST") {
      const data = await parsePostData(req);

      if (req.url === "/api/accounts/add") {
        try {
          const accounts = safeReadJson(ACCOUNTS_FILE);
          accounts.push(data);
          writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          logger.info(`[DASHBOARD] Account added manually: ${data.username}`);
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          logger.error(`[DASHBOARD] Add account failed: ${e.message}`);
          res.writeHead(500);
          res.end(e.message);
        }
        return;
      }

      if (req.url === "/api/accounts/delete") {
        try {
          let accounts = safeReadJson(ACCOUNTS_FILE);
          accounts = accounts.filter((a) => a.username !== data.username);
          writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
        }
        return;
      }

      if (req.url === "/api/accounts/update") {
        try {
          const accounts = safeReadJson(ACCOUNTS_FILE);
          const idx = accounts.findIndex((a) => a.username === data.username);
          if (idx !== -1) {
            if (data.nickname !== undefined)
              accounts[idx].nickname = data.nickname;
            if (data.password !== undefined)
              accounts[idx].password = data.password;
            if (data.sharedSecret !== undefined)
              accounts[idx].sharedSecret = data.sharedSecret;
            writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          }
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
        }
        return;
      }

      if (req.url === "/api/accounts/upload-mafile") {
        try {
          const maData = JSON.parse(data.content);
          const accounts = safeReadJson(ACCOUNTS_FILE);
          accounts.push({
            username: maData.account_name,
            password: "",
            sharedSecret: maData.shared_secret,
          });
          writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          logger.info(
            `[DASHBOARD] Account imported via maFile: ${maData.account_name}`,
          );
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          logger.error(`[DASHBOARD] maFile upload failed: ${e.message}`);
          res.writeHead(400);
          res.end(e.message);
        }
        return;
      }

      if (req.url === "/api/settings/update") {
        try {
          writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
        }
        return;
      }
    }

    if (req.url === "/api/status") {
      appState.system.cpuUsage = getCpuUsage();
      appState.system.totalAccounts = config.accounts.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(appState));
      return;
    }

    // Serve Avatars
    if (req.url.startsWith("/avatars/")) {
      const fileName = req.url.split("/").pop();
      const filePath = `./avatars/${fileName}`;
      if (existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(readFileSync(filePath));
      } else {
        logger.error(`[AVATAR] 404: ${filePath} (CWD: ${process.cwd()})`);
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (req.url === "/" || req.url === "/dashboard") {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>REXREXREX</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23050505'/><path d='M30 30 L70 30 L70 70 L30 70 Z' fill='none' stroke='white' stroke-width='8'/><path d='M50 20 L50 80' stroke='white' stroke-width='8'/></svg>">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #050505;
            --surface: #0a0a0a;
            --border: #1a1a1a;
            --text: #ffffff;
            --text-dim: #666666;
            --accent: #ffffff;
            --accent-dim: #333333;
            --red: #ff4444;
            --green: #44ff44;
            --yellow: #ffff44;
            --font-mono: 'JetBrains Mono', monospace;
            --font-sans: 'Inter', sans-serif;
            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        * { box-sizing: border-box; outline: none; }
        body { 
            background: var(--bg); 
            color: var(--text); 
            margin: 0; 
            font-family: var(--font-sans);
            font-size: 13px;
            overflow-x: hidden;
            letter-spacing: -0.01em;
        }

        /* Tactical Background Grid */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image: radial-gradient(var(--accent-dim) 1px, transparent 1px);
            background-size: 40px 40px;
            opacity: 0.1;
            pointer-events: none;
            z-index: -1;
        }

        /* Layout */
        .app-container { display: flex; min-height: 100vh; }
        
        .sidebar { 
            width: 260px; 
            background: var(--surface); 
            border-right: 1px solid var(--border); 
            padding: 40px 24px; 
            display: flex; 
            flex-direction: column;
            flex-shrink: 0;
        }

        .main-content { 
            flex: 1; 
            padding: 40px;
            overflow-y: auto;
        }

        /* Headers */
        .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 60px; }
        .brand-logo { 
            width: 32px; height: 32px; background: var(--text); color: var(--bg);
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 20px; font-family: var(--font-mono);
        }
        .brand-text h1 { font-size: 20px; margin: 0; font-weight: 800; letter-spacing: -0.05em; }
        .brand-text span { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); display: block; }

        .section-header { 
            display: flex; justify-content: space-between; align-items: flex-end; 
            margin-bottom: 40px; border-bottom: 1px solid var(--border); padding-bottom: 20px;
        }
        .section-header h2 { font-size: 28px; margin: 0; font-weight: 800; letter-spacing: -0.05em; text-transform: uppercase; }
        .section-header p { margin: 5px 0 0; color: var(--text-dim); font-size: 12px; font-family: var(--font-mono); }

        /* Metrics */
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); margin-bottom: 40px; }
        .metric-card { background: var(--bg); padding: 32px; transition: var(--transition); position: relative; overflow: hidden; }
        .metric-card:hover { background: var(--surface); }
        .metric-label { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; font-family: var(--font-mono); margin-bottom: 16px; display: block; }
        .metric-value { font-size: 48px; font-weight: 800; letter-spacing: -0.05em; line-height: 1; margin-bottom: 12px; }
        .metric-sub { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }

        /* Units (Nodes) */
        .units-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
        .unit-card { 
            background: var(--surface); border: 1px solid var(--border); padding: 24px; 
            display: flex; gap: 20px; transition: var(--transition); position: relative;
            cursor: default;
        }
        .unit-card:hover { border-color: var(--text-dim); transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        
        .unit-avatar-container { position: relative; }
        .unit-avatar { width: 70px; height: 70px; object-fit: cover; filter: grayscale(1); border: 1px solid var(--border); transition: var(--transition); }
        .unit-card:hover .unit-avatar { filter: grayscale(0); border-color: var(--text); }
        
        .unit-info { flex: 1; min-width: 0; }
        .unit-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .unit-name { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; display: block; }
        .unit-alias { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }
        
        .unit-status { 
            font-size: 9px; font-weight: 700; padding: 4px 8px; border: 1px solid currentColor;
            text-transform: uppercase; font-family: var(--font-mono);
        }
        .status-ready { color: var(--green); }
        .status-idle { color: var(--yellow); }
        .status-error { color: var(--red); }
        .status-processing { color: var(--text); animation: pulse 2s infinite; }

        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        .unit-progress-bar { height: 2px; background: var(--border); margin: 15px 0; position: relative; overflow: hidden; }
        .unit-progress-fill { height: 100%; background: var(--text); transition: width 1s ease; }

        .unit-controls { display: flex; gap: 10px; margin-top: 15px; }
        .btn-icon { 
            width: 32px; height: 32px; background: transparent; border: 1px solid var(--border); color: var(--text-dim);
            display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition);
        }
        .btn-icon:hover { border-color: var(--text); color: var(--text); }
        .btn-icon svg { width: 14px; height: 14px; }

        /* Chart */
        .chart-box { 
            background: var(--surface); border: 1px solid var(--border); padding: 30px; margin-bottom: 40px;
            position: relative; overflow: hidden;
        }
        .chart-label { font-size: 11px; font-family: var(--font-mono); color: var(--text-dim); text-transform: uppercase; margin-bottom: 30px; display: block; }
        .chart-container { height: 200px; width: 100%; position: relative; }
        .chart-svg { width: 100%; height: 100%; overflow: visible; }
        .chart-line { fill: none; stroke: var(--text); stroke-width: 2; }
        .chart-area { fill: rgba(255,255,255,0.05); }
        .chart-dot { fill: var(--text); stroke: var(--bg); stroke-width: 2; transition: var(--transition); r: 0; }
        .chart-dot.active { r: 5; }
        
        .chart-tooltip {
            position: absolute; background: white; color: black; padding: 5px 10px; font-family: var(--font-mono);
            font-size: 10px; font-weight: 700; pointer-events: none; display: none; transform: translate(-50%, -100%);
            margin-top: -10px;
        }

        /* Terminal */
        .terminal-container { background: var(--surface); border: 1px solid var(--border); padding: 0; display: flex; flex-direction: column; height: 400px; }
        .terminal-header { padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; }
        .terminal-header span { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); text-transform: uppercase; }
        .terminal-stream { flex: 1; padding: 20px; overflow-y: auto; font-family: var(--font-mono); font-size: 11px; line-height: 1.6; }
        .log-line { margin-bottom: 4px; display: flex; gap: 15px; }
        .log-ts { color: var(--text-dim); }
        .log-msg.success { color: var(--green); }
        .log-msg.error { color: var(--red); }
        .log-msg.warn { color: var(--yellow); }

        /* Buttons & Interaction */
        .action-bar { display: flex; gap: 15px; }
        .btn-prime { 
            background: var(--text); color: var(--bg); border: none; padding: 12px 24px; 
            font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
            cursor: pointer; transition: var(--transition); font-family: var(--font-mono);
        }
        .btn-prime:hover { filter: invert(1); transform: translateY(-2px); }
        .btn-prime:active { transform: translateY(0); }

        .btn-ghost {
            background: transparent; color: var(--text); border: 1px solid var(--border); padding: 12px 24px;
            font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
            cursor: pointer; transition: var(--transition); font-family: var(--font-mono);
        }
        .btn-ghost:hover { border-color: var(--text); background: rgba(255,255,255,0.05); }

        /* Modal */
        .modal { 
            position: fixed; inset: 0; background: rgba(0,0,0,0.9); backdrop-filter: blur(10px); 
            display: none; align-items: center; justify-content: center; z-index: 1000;
        }
        .modal-inner { background: var(--surface); border: 1px solid var(--border); padding: 60px; width: 500px; position: relative; }
        .modal-inner h3 { font-size: 24px; margin: 0 0 40px; text-transform: uppercase; letter-spacing: -0.05em; }
        input { 
            display: block; width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border);
            padding: 15px 0; color: #fff; font-family: var(--font-mono); font-size: 14px; margin-bottom: 30px; transition: var(--transition);
        }
        input:focus { border-color: var(--text); }

        /* Responsive */
        @media (max-width: 1000px) {
            .app-container { flex-direction: column; }
            .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); padding: 20px; }
            .brand { margin-bottom: 20px; }
            .main-content { padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <aside class="sidebar">
            <div class="brand">
                <div class="brand-logo">R</div>
                <div class="brand-text"><h1>REX-1337</h1><span>SYSTEM NODE V1.4.0</span></div>
            </div>
            <span class="metric-label" style="margin-bottom:20px">PERFORMANCE RANKING</span>
            <div id="rankings" style="margin-bottom:60px"></div>
            <div style="margin-top:auto">
                <span class="metric-label" style="margin-bottom:20px">CORE DEPENDENCIES</span>
                <div id="api-status" style="display:grid; gap:12px; font-family:var(--font-mono); font-size:10px; font-weight:700;"></div>
                <div style="margin-top:40px; border-top:1px solid var(--border); padding-top:20px;">
                    <a href="https://github.com/1vilio/rex1337" target="_blank" style="color:var(--text-dim); text-decoration:none; font-family:var(--font-mono); font-size:10px; text-transform:uppercase; letter-spacing:0.1em; display:flex; align-items:center; gap:8px;">
                        <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                        GITHUB <span style="margin-left:auto">→</span>
                    </a>
                </div>
            </div>
        </aside>
        <main class="main-content">
            <header class="section-header">
                <div><h2>REXREXREX</h2><p id="system-status">Status: Nominal // Data sync active</p></div>
                <div class="action-bar">
                    <button class="btn-prime" onclick="openModal('add-modal')">+ INITIALIZE NODE</button>
                    <button class="btn-ghost" onclick="document.getElementById('mafile-input').click()">IMPORT MANIFEST</button>
                    <input type="file" id="mafile-input" style="display:none" onchange="uploadMaFile(this)">
                </div>
            </header>
            <div class="metrics-grid">
                <div class="metric-card"><span class="metric-label">EARNINGS / 24H</span><div class="metric-value" id="stat-today">0</div><div class="metric-sub" id="stat-cph">AVG 0.0/H</div></div>
                <div class="metric-card"><span class="metric-label">LATENCY INDEX</span><div class="metric-value" id="stat-avg">0.0s</div><div class="metric-sub" id="stat-active-nodes">0 NODES ACTIVE</div></div>
                <div class="metric-card"><span class="metric-label">RESOURCES</span><div class="metric-value" id="sys-cpu">0.0%</div><div class="metric-sub" id="sys-mem">0.00 MB RAM</div></div>
            </div>
            <div class="chart-box">
                <span class="chart-label">THROUGHPUT ANALYSIS // 24H TREND</span>
                <div class="chart-container" id="chart-container">
                    <svg class="chart-svg" id="activity-chart" preserveAspectRatio="none"><path class="chart-area" d=""></path><path class="chart-line" d=""></path></svg>
                    <div id="chart-tooltip" class="chart-tooltip"></div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 400px; gap:40px; align-items: flex-start;">
                <div><span class="metric-label" style="margin-bottom:20px">ACTIVE NODES</span><div class="units-grid" id="unit-list"></div></div>
                <div>
                    <span class="metric-label" style="margin-bottom:20px">LIVE TERMINAL STREAM</span>
                    <div class="terminal-container">
                        <div class="terminal-header"><span>RE-64 STREAM v7</span><span id="cycle-timer">NEXT: CALC...</span></div>
                        <div class="terminal-stream" id="log-box"></div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    <div id="add-modal" class="modal" onclick="if(event.target==this) closeModal('add-modal')">
        <div class="modal-inner">
            <h3>INITIALIZE NEW NODE</h3>
            <input id="new-user" placeholder="ENTITY USERNAME">
            <input id="new-pass" type="password" placeholder="CREDENTIAL_PASS">
            <input id="new-secret" placeholder="AUTH_SHARED_SECRET">
            <div style="display:flex; gap:20px; margin-top:20px;">
                <button class="btn-prime" style="flex:1" onclick="submitAccount()">CONFIRM</button>
                <button class="btn-ghost" style="flex:1" onclick="closeModal('add-modal')">ABORT</button>
            </div>
        </div>
    </div>
    <div id="edit-modal" class="modal" onclick="if(event.target==this) closeModal('edit-modal')">
        <div class="modal-inner">
            <h3 id="edit-title">MODIFY NODE DATA</h3>
            <input id="edit-user" type="hidden">
            <input id="edit-nick" placeholder="ALIAS IDENTIFIER">
            <input id="edit-pass" type="password" placeholder="NEW_CREDENTIAL_PASSPHRASE">
            <input id="edit-secret" placeholder="NEW_AUTH_SECRET">
            <div style="display:flex; gap:20px; margin-top:20px;"><button class="btn-prime" style="flex:1" onclick="saveAccountEdit()">COMMIT CHANGES</button><button class="btn-ghost" style="flex:1" onclick="closeModal('edit-modal')">DISCARD</button></div>
        </div>
    </div>
    <script>
        let lastState = null; let chartData = [];
        async function update() {
          try {
            const res = await fetch('/api/status'); if (!res.ok) throw new Error('ERR'); const data = await res.json(); if (!data || !data.stats) return;
            document.getElementById('stat-today').innerText = (data.stats.todayEarned || 0).toFixed(1);
            document.getElementById('stat-cph').innerText = 'AVG ' + (data.stats.commentsPerHour || 0) + '.0/H';
            document.getElementById('stat-avg').innerText = (data.stats.avgTaskTime ? (data.stats.avgTaskTime/1000).toFixed(1) : 0.0) + 's';
            document.getElementById('stat-active-nodes').innerText = (data.accounts ? data.accounts.filter(a => a.status === 'processing').length : 0) + ' NODES ACTIVE';
            document.getElementById('sys-cpu').innerText = data.system.cpuUsage || '0.0%'; document.getElementById('sys-mem').innerText = data.system.memoryUsage || '0.00 MB';
            document.getElementById('cycle-timer').innerText = 'NEXT: ' + (data.system.nextCycle || 'CALC...');
            const health = data.system.apiStatus || {}; const as = document.getElementById('api-status');
            if (as) as.innerHTML = Object.entries(health).map(([k,v]) => \`<div style="display:flex; align-items:center; gap:10px"><div style="width:10px; height:2px; background:\${v === 'online' ? 'var(--green)' : 'var(--red)'};"></div><span>\${k.toUpperCase()} \${v === 'online' ? 'ACTIVE' : 'OFFLINE'}</span></div>\`).join('');

            const rc = document.getElementById('rankings'); if (rc && data.accounts) {
                const sorted = [...data.accounts].sort((a,b) => (b.totalCompleted||0) - (a.totalCompleted||0)).slice(0, 5);
                rc.innerHTML = sorted.map((acc, i) => \`<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-family:var(--font-mono); font-size:11px;"><div><span style="color:var(--text-dim); margin-right:10px;">0\${i+1}</span><span style="font-weight:700">\${(acc.nickname || acc.username).toUpperCase()}</span></div><span style="color:var(--text-dim)">\${(acc.totalCompleted || 0).toFixed(0)}</span></div>\`).join('');
            }
            chartData = data.stats.taskHistory || []; renderChart(chartData); const ul = document.getElementById('unit-list'); if (ul && data.accounts) {
                ul.innerHTML = data.accounts.map((acc, i) => {
                    const statusClass = acc.status === 'farm' ? 'status-ready' : acc.status === 'idle' ? 'status-idle' : acc.status === 'processing' ? 'status-processing' : 'status-error';
                    const avatar = acc.status === 'farm' || acc.status === 'processing' ? '/avatars/farm.png' : acc.status === 'idle' ? '/avatars/idle.png' : '/avatars/error.png';
                    
                    let rearmText = '';
                    if (acc.status === 'idle' && acc.cooldownUntil) {
                        const remaining = Math.max(0, acc.cooldownUntil - Date.now());
                        if (remaining > 0) {
                            const hours = Math.floor(remaining / 3600000);
                            const minutes = Math.floor((remaining % 3600000) / 60000);
                            rearmText = \`<div style="font-family:var(--font-mono); font-size:9px; color:var(--yellow); margin-top:5px;">RE-ARM: \${hours}h \${minutes}m remaining</div>\`;
                        } else {
                            rearmText = \`<div style="font-family:var(--font-mono); font-size:9px; color:var(--green); margin-top:5px;">RE-ARM: READY</div>\`;
                        }
                    }

                    return \`<div class="unit-card"><div class="unit-avatar-container"><img src="\${avatar}" class="unit-avatar" onerror="this.src='/avatars/error.png'"></div><div class="unit-info"><div class="unit-header"><div><span class="unit-name">NODE N\${i+1} - \${(acc.nickname || acc.username).toUpperCase()}</span><span class="unit-alias">ID: \${acc.username.toUpperCase()}</span></div><span class="unit-status \${statusClass}">\${acc.status}</span></div><div class="unit-progress-bar"><div class="unit-progress-fill" style="width:\${((acc.progress || 0)/10)*100}%"></div></div><div style="display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:9px; color:var(--text-dim); text-transform:uppercase;"><span>Cycle Completion</span><span>\${acc.progress || 0} / 10.0</span></div>\${rearmText}<div class="unit-controls">\${acc.steamID ? \`<button class="btn-icon" title="NODE LINK" onclick="window.open('https://steamcommunity.com/profiles/\${acc.steamID}', '_blank')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg></button>\`:''}<button class="btn-icon" title="MODIFY" onclick="editAccountPrompt('\${acc.username}', '\${acc.nickname||''}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button><button class="btn-icon" style="color:var(--red)" title="PURGE" onclick="deleteAccount('\${acc.username}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div></div>\`; }).join('');
            }
            const lb = document.getElementById('log-box'); if (lb && data.logs && JSON.stringify(data.logs) !== JSON.stringify(lastState?.logs)) {
                lb.innerHTML = \`--- BOOT SEQUENCE INITIATED ---\\n\` + data.logs.map(l => \`<div class="log-line"><span class="log-ts">[\${l.time || ''}]</span><span class="log-msg \${l.type || ''}">\${l.text.toUpperCase() || ''}</span></div>\`).join(''); lb.scrollTop = lb.scrollHeight;
            }
            lastState = data;
          } catch(e) { console.error(e); }
        }
        function renderChart(history) {
            const container = document.getElementById('chart-container'); const svg = document.getElementById('activity-chart'); const line = svg.querySelector('.chart-line'); const area = svg.querySelector('.chart-area');
            svg.querySelectorAll('.chart-dot').forEach(el => el.remove()); if (!history.length) return;
            const now = Date.now(); const bins = new Array(24).fill(0); history.forEach(t => { const age = (now - t) / 3600000; if (age < 24) bins[23 - Math.floor(age)]++; });
            const max = Math.max(...bins, 1); const w = container.clientWidth; const h = container.clientHeight;
            const points = bins.map((v, i) => ({ x: (i/23)*w, y: h - (v/max)*h, v: v, h: (23-i) }));
            const pathData = 'M' + points.map(p => \`\${p.x},\${p.y}\`).join(' '); const areaData = pathData + \` L\${w},\${h} L0,\${h} Z\`;
            line.setAttribute('d', pathData); area.setAttribute('d', areaData);
            points.forEach(p => {
                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('class', 'chart-dot');
                dot.addEventListener('mouseenter', () => { dot.classList.add('active'); const tt = document.getElementById('chart-tooltip'); tt.style.display = 'block'; tt.style.left = p.x + 'px'; tt.style.top = p.y + 'px'; tt.innerText = \`STATS: \${p.v} MSGS // \${p.h}H AGO\`; });
                dot.addEventListener('mouseleave', () => { dot.classList.remove('active'); document.getElementById('chart-tooltip').style.display = 'none'; });
                svg.appendChild(dot);
            });
        }
        function openModal(id) { const m = document.getElementById(id); m.style.display = 'flex'; setTimeout(() => m.style.opacity = '1', 10); }
        function closeModal(id) { const m = document.getElementById(id); m.style.opacity = '0'; setTimeout(() => m.style.display = 'none', 300); }
        async function submitAccount() {
            const u = document.getElementById('new-user').value; const p = document.getElementById('new-pass').value; const s = document.getElementById('new-secret').value;
            const res = await fetch('/api/accounts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({username:u, password:p, sharedSecret:s}) }); if (res.ok) window.location.reload();
        }
        async function saveAccountEdit() {
            const u = document.getElementById('edit-user').value; const n = document.getElementById('edit-nick').value; const p = document.getElementById('edit-pass').value; const s = document.getElementById('edit-secret').value; const data = { username: u, nickname: n }; if (p) data.password = p; if (s) data.sharedSecret = s;
            await fetch('/api/accounts/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); closeModal('edit-modal'); update();
        }
        function editAccountPrompt(u, n) { document.getElementById('edit-user').value = u; document.getElementById('edit-nick').value = n; document.getElementById('edit-pass').value = ''; document.getElementById('edit-secret').value = ''; document.getElementById('edit-title').innerText = 'MODIFY NODE: ' + u.toUpperCase(); openModal('edit-modal'); }
        async function deleteAccount(u) { if (!confirm('PURGE ' + u + '?')) return; await fetch('/api/accounts/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({username:u}) }); update(); }
        async function uploadMaFile(i) {
            const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = async (e) => { const res = await fetch('/api/accounts/upload-mafile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({content: e.target.result}) }); if(res.ok) update(); }; r.readAsText(f);
        }
        setInterval(update, 2000); update(); window.addEventListener('resize', () => renderChart(chartData));
    </script>
</body>
</html>`;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info(`Dashboard running on port ${port}`);
    updateAppState({ logEntry: `Dashboard server started on port ${port}` });
  });
  return server;
}

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getTrackerPath() {
  if (process.env.TRACKER_FILE) return process.env.TRACKER_FILE;
  if (fs.existsSync('/home/misty/.pm2')) {
    return '/home/misty/.pm2/deploy_tracker.json';
  }
  const home = process.env.HOME || '/home/misty';
  return path.join(home, '.pm2', 'deploy_tracker.json');
}

const DATA_FILE = getTrackerPath();
const PM2_DIR = fs.existsSync('/home/misty/.pm2') ? '/home/misty/.pm2' : path.join(process.env.HOME || '/home/misty', '.pm2');

function loadTracker() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveTracker(data) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.chmodSync(DATA_FILE, 0o666);
    } catch (_) {}
  } catch (e) {
    console.error('Failed to save deploy tracker:', e.message);
  }
}

const args = process.argv.slice(2);
const invokedAs = path.basename(process.argv[1]);
const isLog = invokedAs === 'misty-log-deploy' || args[0] === 'log';
const isSync = args[0] === 'sync';

if (isSync) {
  try {
    const pm2Raw = execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 });
    const pm2List = JSON.parse(pm2Raw);
    const data = loadTracker();
    for (const proc of pm2List) {
      const name = proc.name;
      const restarts = proc.pm2_env?.restart_time || 0;
      if (!data[name]) data[name] = { deploys: 0, history: [] };
      data[name].deploys = restarts;
      data[name].last_deploy = new Date().toISOString();
      data[name].last_commit = 'Synced with PM2';
      if (!Array.isArray(data[name].history)) data[name].history = [];
      data[name].history.unshift({ timestamp: new Date().toISOString(), commit: 'sync', note: 'Synced deploys with current PM2 restarts' });
    }
    saveTracker(data);
    console.log('✅ Deploy tracker synced with current PM2 restart counts. All services reset to 0 crashes.');
  } catch (e) {
    console.error('Failed to sync PM2 status:', e.message);
  }
  process.exit(0);
}

if (isLog) {
  const shift = (args[0] === 'log') ? 1 : 0;
  const appName = args[shift];
  const commit = args[shift + 1] || 'N/A';
  const note = args[shift + 2] || 'Standard deploy';
  if (!appName) {
    console.error('Usage: misty-log-deploy <app-name> [commit] [note]');
    process.exit(1);
  }
  const data = loadTracker();
  if (!data[appName]) data[appName] = { deploys: 0, history: [] };
  data[appName].deploys = (data[appName].deploys || 0) + 1;
  data[appName].last_deploy = new Date().toISOString();
  data[appName].last_commit = commit;
  if (!Array.isArray(data[appName].history)) data[appName].history = [];
  data[appName].history.unshift({ timestamp: new Date().toISOString(), commit, note });
  if (data[appName].history.length > 50) data[appName].history.pop();
  saveTracker(data);
  console.log(`[DeployTracker] Recorded deploy #${data[appName].deploys} for ${appName} (${commit}) - ${note}`);
  process.exit(0);
}

function formatUptime(ms) {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d (${hours.toFixed(0)}h)`;
}

try {
  const pm2Raw = execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 });
  const pm2List = JSON.parse(pm2Raw);
  const tracker = loadTracker();

  console.log('\n=================== MISTYVISUALS SERVICES STATUS ===================\n');
  const rows = pm2List.map(proc => {
    const name = proc.name;
    const pm2Restarts = proc.pm2_env?.restart_time || 0;
    const deploys = tracker[name]?.deploys || 0;
    const crashes = Math.max(0, pm2Restarts - deploys);
    const uptime = proc.pm2_env?.pm_uptime ? formatUptime(Date.now() - proc.pm2_env.pm_uptime) : 'N/A';
    const memMb = proc.monit?.memory ? (proc.monit.memory / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A';
    const status = proc.pm2_env?.status || 'unknown';

    return {
      'App Name': name,
      'Status': status,
      'Deploys': deploys,
      'Crashes': crashes,
      'PM2 Total (↺)': pm2Restarts,
      'Uptime': uptime,
      'Memory': memMb,
      'Health': crashes > 0 ? `⚠️ ${crashes} CRASH(ES)` : '✅ Healthy'
    };
  });

  console.table(rows);

  const crashedApps = rows.filter(r => r.Crashes > 0);
  if (crashedApps.length > 0) {
    console.log('⚠️  UNEXPECTED CRASHES DETECTED:');
    for (const app of crashedApps) {
      console.log(`- ${app['App Name']}: ${app.Crashes} crash(es) since tracking started.`);
      const errPath = path.join(PM2_DIR, 'logs', `${app['App Name']}-error.log`);
      if (fs.existsSync(errPath)) {
        try {
          const lastErr = execSync(`tail -n 3 "${errPath}"`, { encoding: 'utf8' }).trim();
          if (lastErr) console.log(`  Recent error snippet:\n  ${lastErr.split('\n').join('\n  ')}`);
        } catch (e) {}
      }
    }
  } else {
    console.log('✨ All processes are 100% healthy with 0 crashes.');
  }
  console.log('\n====================================================================\n');
} catch (err) {
  console.error('Error fetching PM2 status:', err.message);
}

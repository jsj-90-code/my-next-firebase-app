import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function parseTimestampResult(stdout, ips) {
  const value = JSON.parse(stdout);
  const allowed = new Set(ips);
  if (value.targetCount !== allowed.size || !Array.isArray(value.aliveIps) ||
      !Number.isInteger(value.sentCount) || value.sentCount < allowed.size || value.sentCount > allowed.size * 2 ||
      value.aliveIps.some((ip) => typeof ip !== 'string' || !allowed.has(ip))) {
    throw new Error('Incomplete or out-of-range timestamp result');
  }
  return new Set(value.aliveIps);
}

export function combineResponses(ips, byPing, byTcp, timestamp) {
  const allowed = new Set(ips);
  const legacy = new Set([...byPing, ...byTcp].filter((ip) => allowed.has(ip)));
  const extra = [...(timestamp ?? [])].filter((ip) => allowed.has(ip) && !legacy.has(ip));
  return {
    alive: [...new Set([...legacy, ...extra])],
    timestampOnly: extra.length,
    method: timestamp === null ? 'icmp+tcp' : 'icmp+tcp+timestamp',
  };
}

export function timestampAll(ips) {
  if (!ips.length) return Promise.resolve(new Set());
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', '/usr/bin/python3', fileURLToPath(new URL('./timestamp_probe.py', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Timestamp helper exceeded 15 minutes'));
    }, 15 * 60 * 1000); // 기본 회차(핑+TCP)가 ~12분이라 15분 안에 못 끝나면 먹통 — 빨리 포기하고 핑+TCP로(2026-10-08, 걸러진 회차 방지)
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        child.kill('SIGTERM');
        finish(new Error('Timestamp helper output too large'));
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error(`Timestamp helper exit ${code}: ${stderr}`));
      try { finish(null, parseTimestampResult(stdout, ips)); } catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify(ips));
  });
}

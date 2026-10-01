import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'inherit'], shell: true });
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });

const timer = setTimeout(() => { console.error('timeout'); child.kill(); process.exit(1); }, 60000);

try {
  await request('initialize', { clientInfo: { name: 'trmnl-chatgpt-usage', title: 'TRMNL ChatGPT usage', version: '0.0.1' } });
  send({ jsonrpc: '2.0', method: 'initialized' });
  const res = await request('account/usage/read');
  fs.writeFileSync('usage.json', JSON.stringify(res, null, 2));
  const buckets = res.dailyUsageBuckets ?? [];
  console.log('summary:', res.summary);
  console.log('buckets:', buckets.length, buckets[0], buckets.at(-1));
} catch (e) {
  console.error('error:', e.message);
} finally {
  clearTimeout(timer);
  child.kill();
}

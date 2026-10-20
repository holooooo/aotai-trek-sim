// Minimal headless-Chrome CDP helper (Metal GPU WebGL2). Copied from webgl-seascape-video/cdp.mjs.
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ width = 1920, height = 1080 } = {}) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/aotai-promo-chrome-${port}`,
    '--allow-file-access-from-files', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-gpu-watchdog', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });
  const json = async (p, method = 'GET') => {
    for (let i = 0; i < 150; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method }); return await r.json(); } catch { await sleep(100); }
    }
    throw new Error('chrome not reachable');
  };
  await json('/json/version');
  // opts: { dpr, mobile, init } — init is a script injected before any page script runs
  async function open(url, opts = {}) {
    const tgt = await json(`/json/new?${encodeURIComponent(opts.init ? 'about:blank' : url)}`, 'PUT');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(); const logs = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
      else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 2000));
      else if (m.method === 'Inspector.targetCrashed') logs.push('CRASHED');
    };
    const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: opts.w || width, height: opts.h || height, deviceScaleFactor: opts.dpr || 1, mobile: !!opts.mobile });
    if (opts.ua) await send('Emulation.setUserAgentOverride', { userAgent: opts.ua });
    if (opts.touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (opts.init) {
      await send('Page.enable');
      await send('Page.addScriptToEvaluateOnNewDocument', { source: opts.init });
      await send('Page.navigate', { url });
      await sleep(300);
    }
    const evaluate = async (expression) => {
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails, null, 1).slice(0, 3000));
      return m.result?.result?.value;
    };
    for (let i = 0; i < (opts.noWait ? 0 : 600); i++) {
      try { if (await evaluate('document.readyState === "complete" && window.READY === true')) break; } catch {}
      if (logs.some(l => l.startsWith('EXC') || l === 'CRASHED')) break;
      await sleep(50);
    }
    const screenshot = async (quality = 92) => {
      const m = await send('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false });
      return Buffer.from(m.result.data, 'base64');
    };
    return { evaluate, screenshot, logs, send, close: () => ws.close() };
  }
  return { open, kill: () => proc.kill('SIGTERM') };
}

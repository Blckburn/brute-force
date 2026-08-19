#!/usr/bin/env node
/**
 * Локальный аналог статики Render: раздаёт собранный клиент и проксирует
 * /api/* на сервер, снимая префикс.
 *
 * Нужен затем, чтобы проверять ровно ту схему, которая работает у игрока:
 * один origin для страницы и для API, кука сессии первой стороны.
 * Проверять на двух разных портах бессмысленно — это другая ситуация,
 * чем в проде.
 *
 *   node scripts/preview-proxy.mjs [порт] [адрес сервера]
 *   по умолчанию: 4173 и http://127.0.0.1:8787
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? 4173);
const UPSTREAM = (process.argv[3] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const DIST = fileURLToPath(new URL('../apps/web/dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.map': 'application/json',
};

async function proxy(req, res) {
  // Снимаем префикс /api — ровно как rewrite в render.yaml.
  const target = UPSTREAM + req.url.replace(/^\/api/, '');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      redirect: 'manual',
    });

    // getSetCookie сохраняет несколько кук по отдельности; склеивать их
    // в одну строку нельзя — сессия перестанет ставиться.
    const out = {};
    upstream.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'set-cookie') out[name] = value;
    });
    res.writeHead(upstream.status, { ...out, 'set-cookie': upstream.headers.getSetCookie() });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream недоступен', detail: String(err) }));
  }
}

createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    void proxy(req, res);
    return;
  }

  const requested = normalize(join(DIST, decodeURIComponent(req.url.split('?')[0])));
  const file =
    requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(DIST, 'index.html');

  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`клиент и API на одном origin: http://127.0.0.1:${PORT} (API -> ${UPSTREAM})`);
});

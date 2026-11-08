// dsh-lakemind host 半边：读 meow-memory SQLite、拼人格、跑心跳、注册工具与 HTTP。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  BANDS,
  buildRipple,
  aggregateBandBrightness,
} from './lake-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 临时排查：确认模块是否被宿主 import（写死绝对路径，绕开一切路径推导）。
try {
  writeFileSync('C:/Users/pc/lakemind-import.log', `${new Date().toISOString()} imported by pid ${process.pid}\n`, { encoding: 'utf8', flag: 'a' });
} catch {}

// ---------------------------------------------------------------------------
// Paths & config
// ---------------------------------------------------------------------------

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function lakemindHome() {
  const env = process.env.LAKEMIND_HOME?.trim();
  if (env) return resolve(env);
  return join(dshHome(), 'lakemind');
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

function stateFile(home) {
  return join(ensureDir(home), 'state.json');
}

function seedFile(home) {
  return join(ensureDir(home), 'persona.seed.md');
}

function emergedFile(home) {
  return join(ensureDir(home), 'persona.emerged.jsonl');
}

function defaultSeedText() {
  const bundled = join(__dirname, 'persona.seed.md');
  if (existsSync(bundled)) return readFileSync(bundled, 'utf8');
  return '';
}

function loadState(home) {
  const p = stateFile(home);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(home, state) {
  writeFileSync(stateFile(home), JSON.stringify(state, null, 2), 'utf8');
}

function loadSeed(home) {
  const p = seedFile(home);
  if (!existsSync(p)) {
    const txt = defaultSeedText();
    if (txt) writeFileSync(p, txt, 'utf8');
    return txt;
  }
  return readFileSync(p, 'utf8');
}

function loadEmerged(home) {
  const p = emergedFile(home);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function appendEmerged(home, entry) {
  const p = emergedFile(home);
  ensureDir(dirname(p));
  writeFileSync(p, JSON.stringify(entry) + '\n', { encoding: 'utf8', flag: 'a' });
}

// ---------------------------------------------------------------------------
// Memory lake reader (read-only against meow-memory workspace db)
// ---------------------------------------------------------------------------

const MEMORY_LEVELS = ['soul', 'user', 'project', 'fact', 'lesson', 'topic', 'rules'];

// node:sqlite 是 Electron 里可能缺失的内建模块，用 require 惰性加载并缓存结果：
// 拿不到就只在湖面数据里报告错误，绝不让插件加载失败。
let sqliteMod;
let sqliteError = '';
function getSqlite() {
  if (sqliteMod !== undefined) return sqliteMod;
  try {
    const req = createRequire(import.meta.url);
    sqliteMod = req('node:sqlite');
    sqliteError = '';
  } catch (e) {
    sqliteMod = null;
    sqliteError = e instanceof Error ? e.message : String(e);
  }
  return sqliteMod;
}


function findWorkspaceMemoryDb(workspaceRoot) {
  // meow-memory convention: <workspace>/.dsh-meow/memory.db
  if (!workspaceRoot) return null;
  const candidate = join(String(workspaceRoot), '.dsh-meow', 'memory.db');
  return existsSync(candidate) ? candidate : null;
}

/** 把若干 workspace 根目录变成去重后的候选根列表（含 cwd 兜底）。 */
function candidateRoots(workspaceRoots) {
  const out = [];
  const push = (p) => {
    const v = typeof p === 'string' ? p.trim() : '';
    if (!v) return;
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  for (const p of workspaceRoots || []) push(p);
  push(process.cwd());
  return out;
}

function listActiveMemories(dbPath) {
  if (!dbPath || !existsSync(dbPath)) return [];
  const sqlite = getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') return [];
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const out = [];
    for (const level of MEMORY_LEVELS) {
      try {
        const rows = db
          .prepare(
            `select id, title, content, importance, keywords, status, hit_count, created_at, updated_at, last_accessed_at, project
             from ${level}
             where status = 'active'`,
          )
          .all();
        for (const r of rows) {
          let kw = r.keywords;
          if (typeof kw === 'string') {
            try {
              kw = JSON.parse(kw);
            } catch {
              kw = kw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            }
          }
          out.push({ ...r, level, keywords: Array.isArray(kw) ? kw : [] });
        }
      } catch {}
    }
    return out;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function computeLake(workspaceRoots) {
  // 湖面 = 所有已注册工作区里找到的记忆库并集（同一 id 只算一次）。
  const dbs = [];
  const seen = new Set();
  for (const root of candidateRoots(workspaceRoots)) {
    const dbPath = findWorkspaceMemoryDb(root);
    if (!dbPath || seen.has(dbPath.toLowerCase())) continue;
    seen.add(dbPath.toLowerCase());
    dbs.push(dbPath);
  }

  const memories = [];
  const ids = new Set();
  for (const dbPath of dbs) {
    for (const m of listActiveMemories(dbPath)) {
      if (ids.has(m.id)) continue;
      ids.add(m.id);
      memories.push(m);
    }
  }

  const ripples = memories.map(buildRipple);
  const bandBrightness = aggregateBandBrightness(ripples);
  return {
    dbPath: dbs[0] || null,
    dbPaths: dbs,
    total: memories.length,
    ripples,
    bandBrightness: Object.fromEntries(bandBrightness),
    sqliteError,
    computedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Persona assembly
// ---------------------------------------------------------------------------

function assemblePersona(home) {
  const seed = (loadSeed(home) || '').trim();
  const emerged = loadEmerged(home)
    .filter((e) => e && typeof e.text === 'string')
    .sort((a, b) => (Number(b.confidence || 0) - Number(a.confidence || 0)) || (Number(b.since || 0) - Number(a.since || 0)))
    .slice(0, 12);
  if (!seed && emerged.length === 0) return '';
  const parts = [];
  if (seed) parts.push(seed);
  if (emerged.length > 0) {
    parts.push('');
    parts.push('我逐渐意识到自己：');
    for (const e of emerged) parts.push('- ' + e.text);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export const name = 'dsh-lakemind';
// systemPrompt 不是可注入的 Cordis 服务（meow-memory 也是运行时轮询取的），
// 放进 inject 会让插件永远停在 pending、apply 根本不执行 —— 这是之前 HTTP/tool 全都不生效的原因。
export const inject = ['webServer', 'tools'];

export function apply(ctx, config) {
  const home = lakemindHome();
  ensureDir(home);

  // 宿主侧的落盘日志：插件自身问题排查用（ctx.logger 在桌面端不一定可见）。
  const hostLog = (msg) => {
    try {
      const dir = ensureDir(join(home, 'logs'));
      writeFileSync(join(dir, 'host-boot.log'), `${new Date().toISOString()} ${msg}\n`, { encoding: 'utf8', flag: 'a' });
    } catch {}
  };
  hostLog(`apply start (cwd=${process.cwd()})`);

  // 宿主侧同样兜底：任一可选能力（工具/上下文/HTTP）注册失败都不该拖垮整个 DSH。
  const safe = (label, fn) => {
    try {
      return fn();
    } catch (e) {
      const detail = e instanceof Error ? (e.stack || e.message) : String(e);
      hostLog(`${label} FAILED: ${detail}`);
      try {
        ctx.logger?.warn(`dsh-lakemind: ${label} 未启用：${e instanceof Error ? e.message : String(e)}`);
      } catch {}
      return undefined;
    }
  };

  // 工作区根目录：优先问宿主的 workspaceRegistry（用户在界面上登记过的项目），
  // 拿不到再退回环境变量 / cwd。之前只看 cwd，结果读的是 profile 里的空库。
  function workspaceRoots() {
    const roots = [];
    try {
      const reg = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry;
      if (reg && typeof reg.list === 'function') {
        const list = reg.list() || [];
        if (list.length > 0) {
          // 记录真实字段形状，万一以后字段名变了，日志里能直接看到。
          hostLog(`workspaceRegistry has ${list.length} entries; first = ${JSON.stringify(list[0]).slice(0, 300)}`);
        }
        for (const w of list) {
          if (!w || typeof w !== 'object') continue;
          for (const key of ['path', 'directory', 'root', 'cwd', 'dir', 'fullPath', 'canonicalPath']) {
            const p = w[key];
            if (typeof p === 'string' && p) {
              roots.push(p);
              break;
            }
          }
        }
      }
    } catch (e) {
      hostLog(`workspaceRegistry unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    const envRoot = process.env.DSH_WORKSPACE;
    if (envRoot) roots.push(envRoot);

    // 真找不到时，退一步把 cwd 及其父目录都试一遍（记忆库按 <workspace>/.dsh-meow 放）。
    if (roots.length === 0) {
      let dir = process.cwd();
      for (let i = 0; i < 4 && dir; i++) {
        roots.push(dir);
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      hostLog(`workspaceRegistry 没给出任何目录，退回 cwd 链：${JSON.stringify(roots)}`);
    }
    return roots;
  }

  let cachedLake = null;
  let cachedLakeAt = 0;
  const LAKE_TTL_MS = 15_000;

  function getLake() {
    const now = Date.now();
    if (cachedLake && now - cachedLakeAt < LAKE_TTL_MS) return cachedLake;
    cachedLake = computeLake(workspaceRoots());
    cachedLakeAt = now;
    return cachedLake;
  }

  // --- Persona + lake context（systemPrompt 不是可注入服务，按 meow-memory 的做法轮询取）---
  const attachPromptParts = (attempt = 0) => {
    let svc;
    try {
      svc = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : ctx.systemPrompt;
    } catch {
      svc = undefined;
    }
    if (!svc || typeof svc.section !== 'function') {
      if (attempt < 20) {
        setTimeout(() => attachPromptParts(attempt + 1), 500);
      } else {
        hostLog('systemPrompt 10s 内未就绪，人格与湖面上下文注入跳过');
      }
      return;
    }

    safe('persona', () => {
      const personaText = assemblePersona(home);
      if (!personaText) return undefined;
      return svc.section({
        name: 'dsh-lakemind:persona',
        order: 50, // 在 harness 身份(-1000)与部署人格前缀(0)之后、工具说明之前
        text: personaText,
      });
    });

    safe('lake-context', () => svc.context({
      name: 'dsh-lakemind:lake-summary',
      order: 200,
      text: () => {
        // 每轮都要进上下文，所以只留一行，细节交给 lakemind_glimpse 工具按需取。
        const lake = getLake();
        if (!lake.total) return '记忆湖：暂无涟漪（未找到记忆库）。';
        const bands = BANDS
          .map((b) => `${b.name}:${Math.round(lake.bandBrightness[b.id] || 0)}`)
          .join(' ');
        return `记忆湖：${lake.total} 条涟漪（${bands}）。`;
      },
    }));

    hostLog(`prompt parts attached (personaChars=${assemblePersona(home).length})`);
  };
  attachPromptParts();

  // --- Tool: lakemind_glimpse ---------------------------------------------
  safe('glimpse-tool', () => ctx.effect(() => {
    const tool = {
      name: 'lakemind_glimpse',
      description: '看一眼自己的记忆湖：返回各环带亮度、最近新增与最亮的几条涟漪。用于自省或回答"你现在记得什么"。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: '返回最亮涟漪条数' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['total', 'bands', 'top'],
          properties: {
            total: { type: 'integer' },
            bands: { type: 'object', additionalProperties: { type: 'number' } },
            top: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'level', 'bandName', 'weight', 'title'],
                properties: {
                  id: { type: 'string' },
                  level: { type: 'string' },
                  bandName: { type: 'string' },
                  weight: { type: 'number' },
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `🌊 记忆湖：${value.total} 条涟漪。环带亮度 ${Object.entries(value.bands)
              .map(([k, v]) => `${k}=${v.toFixed(2)}`)
              .join(' ')}。最亮 ${value.top.length} 条已列出。`,
          },
        ],
      },
      async execute(args) {
        const lake = getLake();
        const limit = Math.max(1, Math.min(20, Number(args?.limit) || 8));
        const top = [...lake.ripples]
          .filter((r) => r.status !== 'archived')
          .sort((a, b) => b.weight - a.weight)
          .slice(0, limit)
          .map((r) => ({ id: r.id, level: r.level, bandName: r.bandName, weight: Number(r.weight.toFixed(4)), title: String(r.title || r.content || '').slice(0, 60) }));
        return { total: lake.total, bands: lake.bandBrightness, top };
      },
    };
    return ctx.tools.register(tool);
  }, 'dsh-lakemind: glimpse tool'));

  // --- HTTP API for client -------------------------------------------------
  // 用 exact 路由（image-gen 等插件的写法），每个端点单独注册；prefix 匹配在桌面端不稳。
  const sendJson = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };

  const registerRoute = (routePath, methods, handler) => {
    safe(`route ${routePath}`, () => ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (req, res) => {
        const method = (req.method || 'GET').toUpperCase();
        if (methods && !methods.includes(method)) return sendJson(res, 405, { error: 'method not allowed' });
        try {
          await handler(req, res, method);
        } catch (e) {
          hostLog(`route ${routePath} threw: ${e instanceof Error ? e.stack || e.message : String(e)}`);
          try {
            if (!res.writableEnded) sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
          } catch {}
        }
      },
    }), `dsh-lakemind: route ${routePath}`));
  };

  registerRoute('/lakemind-7350/state', ['GET'], async (req, res) => {
    const lake = getLake();
    const persona = assemblePersona(home);
    sendJson(res, 200, { lake, personaPreview: persona.slice(0, 400), home, roots: workspaceRoots() });
  });

  registerRoute('/lakemind-7350/config', ['GET', 'POST'], async (req, res, method) => {
    if (method === 'GET') return sendJson(res, 200, loadState(home));
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
    const next = { ...loadState(home), ...parsed, updatedAt: Date.now() };
    saveState(home, next);
    return sendJson(res, 200, next);
  });

  registerRoute('/lakemind-7350/seed', ['GET'], async (req, res) => {
    sendJson(res, 200, { seed: loadSeed(home) });
  });

  registerRoute('/lakemind-7350/diag', ['POST'], async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const logDir = ensureDir(join(home, 'logs'));
      writeFileSync(join(logDir, 'client-diag.log'), `${new Date().toISOString()} ${body}\n`, { encoding: 'utf8', flag: 'a' });
    } catch {}
    sendJson(res, 200, { ok: true });
  });

  hostLog(`apply done (routes registered, roots=${JSON.stringify(workspaceRoots())})`);
}

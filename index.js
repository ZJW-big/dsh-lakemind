// dsh-lakemind host 半边：读 meow-memory SQLite、拼人格、跑心跳、注册工具与 HTTP。
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

// 日志轮转：插件自己的日志会随运行时间无限增长（之前 host-boot.log 堆到 80KB+），
// 超过阈值就滚成 .1，只保留一代，避免把用户磁盘写满。
const MAX_LOG_BYTES = 512 * 1024;
// 人格段落进系统提示，给个硬上限，防止手写的种子文件写飞。
const MAX_PERSONA_CHARS = 4000;

function appendLogRotating(file, line) {
  try {
    ensureDir(dirname(file));
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      size = 0;
    }
    if (size > MAX_LOG_BYTES) {
      try {
        renameSync(file, file + '.1');
      } catch {
        try {
          writeFileSync(file, '', 'utf8');
        } catch {}
      }
    }
    writeFileSync(file, line, { encoding: 'utf8', flag: 'a' });
  } catch {
    /* 日志失败绝不影响功能 */
  }
}

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
    const data = JSON.parse(readFileSync(p, 'utf8'));
    // 只接受普通对象：数组 / null / 数字都会让后面的展开合并出意外结果。
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

function saveState(home, state) {
  // 先写临时文件再 rename：中途崩溃也不会留下半截 JSON 把配置读坏。
  const target = stateFile(home);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, target);
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

/** meow-memory 以后可能加新表：先看库里实际有哪些表，再退回固定清单。 */
function resolveLevels(db) {
  const known = [];
  let names = [];
  try {
    names = db.prepare(`select name from sqlite_master where type = 'table'`).all().map((r) => String(r.name));
  } catch {
    return MEMORY_LEVELS.slice();
  }
  for (const n of MEMORY_LEVELS) if (names.includes(n)) known.push(n);
  if (known.length === 0) return MEMORY_LEVELS.slice();
  for (const n of names) {
    if (known.includes(n) || MEMORY_LEVELS.includes(n)) continue;
    if (/^(sqlite_|dream_log$|windows$)/i.test(n)) continue;
    try {
      const cols = db.prepare(`pragma table_info("${n.replace(/"/g, '""')}")`).all().map((c) => String(c.name));
      if (cols.includes('content') && cols.includes('importance') && cols.includes('status')) known.push(n);
    } catch {}
  }
  return known;
}

function listActiveMemories(dbPath) {
  const empty = { rows: [], busy: false, error: '' };
  if (!dbPath || !existsSync(dbPath)) return empty;
  const sqlite = getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    return { rows: [], busy: false, error: sqliteError || 'node:sqlite unavailable' };
  }

  let db;
  try {
    // 只读打开：meow-memory 正在写入时这里可能拿不到锁，别让异常冒到上层。
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], busy: /busy|locked/i.test(msg), error: msg };
  }

  const out = [];
  let busy = false;
  let error = '';
  try {
    for (const level of resolveLevels(db)) {
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
      } catch (e) {
        // 被锁住时这一层读不到——标记出来，让上层不要缓存这份残缺结果。
        // 其他错误（库损坏、表结构不对）也要记下来，否则界面上只会显示"没有涟漪"。
        const msg = e instanceof Error ? e.message : String(e);
        if (/busy|locked/i.test(msg)) busy = true;
        else if (!error) error = msg;
      }
    }
    return { rows: out, busy, error };
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
  let unstable = false;
  let readError = '';
  for (const dbPath of dbs) {
    const { rows, busy, error } = listActiveMemories(dbPath);
    if (busy) unstable = true;
    if (error && !readError) readError = `${dbPath}: ${error}`;
    for (const m of rows) {
      if (ids.has(m.id)) continue;
      ids.add(m.id);
      memories.push(m);
    }
  }

  const ripples = [];
  for (const m of memories) {
    try {
      ripples.push(buildRipple(m));
    } catch {
      /* 单条脏数据不该让整片湖消失 */
    }
  }
  const bandBrightness = aggregateBandBrightness(ripples);
  return {
    dbPath: dbs[0] || null,
    dbPaths: dbs,
    total: ripples.length,
    ripples,
    bandBrightness: Object.fromEntries(bandBrightness),
    sqliteError: readError || sqliteError,
    // 被 SQLite 锁住时读到的是残缺结果：上层据此跳过缓存，下次重算。
    unstable,
    computedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Persona assembly
// ---------------------------------------------------------------------------

function assemblePersona(home) {
  // 人格段会直接进系统提示：任何一个文件读失败都不该让这一轮对话崩掉，所以全部兜底。
  let seed = '';
  try {
    seed = (loadSeed(home) || '').trim();
  } catch {
    seed = '';
  }
  let emerged = [];
  try {
    emerged = loadEmerged(home)
      .filter((e) => e && typeof e.text === 'string' && e.text.trim())
      .sort((a, b) => (Number(b.confidence || 0) - Number(a.confidence || 0)) || (Number(b.since || 0) - Number(a.since || 0)))
      .slice(0, 12);
  } catch {
    emerged = [];
  }
  if (!seed && emerged.length === 0) return '';
  const parts = [];
  // 种子人格是手写文件，写太长会把提示挤爆——留一个上限。
  if (seed) parts.push(seed.slice(0, MAX_PERSONA_CHARS));
  if (emerged.length > 0) {
    parts.push('');
    parts.push('我逐渐意识到自己：');
    for (const e of emerged) parts.push('- ' + e.text.trim().slice(0, 200));
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
  // 走轮转写入，避免长期运行把日志堆到几十上百 KB。
  const hostLog = (msg) => {
    appendLogRotating(join(home, 'logs', 'host-boot.log'), `${new Date().toISOString()} ${msg}\n`);
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
  // 拿不到再退回环境变量 / cwd。
  let loggedRegistryOnce = false;

  // registry 的条目形状是 { id, record: { path, title, sessionIds } }，
  // 路径在 record 里面而不是顶层。之前只在顶层找 path，永远找不到，
  // 湖能读对纯粹是因为 cwd 兜底刚好也落在同一个目录——换个工作区就瞎了。
  function pickPath(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 2) return null;
    for (const key of ['path', 'directory', 'root', 'cwd', 'dir', 'fullPath', 'canonicalPath']) {
      const p = obj[key];
      if (typeof p === 'string' && p.trim()) return p.trim();
    }
    return pickPath(obj.record, depth + 1);
  }

  function workspaceRoots() {
    const roots = [];
    try {
      const reg = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry;
      if (reg && typeof reg.list === 'function') {
        const list = reg.list() || [];
        if (list.length > 0 && !loggedRegistryOnce) {
          // 只在首次记录真实字段形状，否则每次取湖都会重复写一行（会撑爆日志）。
          loggedRegistryOnce = true;
          hostLog(`workspaceRegistry has ${list.length} entries; first = ${JSON.stringify(list[0]).slice(0, 300)}`);
        }
        for (const w of list) {
          const p = pickPath(w, 0);
          if (p) roots.push(p);
        }
      }
    } catch (e) {
      hostLog(`workspaceRegistry unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    const envRoot = process.env.DSH_WORKSPACE;
    if (envRoot && !roots.includes(envRoot)) roots.push(envRoot);

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

  function emptyLake(reason) {
    const bandBrightness = {};
    for (const b of BANDS) bandBrightness[b.id] = 0;
    return {
      dbPath: null,
      dbPaths: [],
      total: 0,
      ripples: [],
      bandBrightness,
      sqliteError: reason || '',
      unstable: false,
      computedAt: Date.now(),
    };
  }

  function getLake() {
    const now = Date.now();
    if (cachedLake && now - cachedLakeAt < LAKE_TTL_MS) return cachedLake;
    let next;
    try {
      next = computeLake(workspaceRoots());
    } catch (e) {
      // 读库失败绝不能让异常冒进系统提示：那会让每一轮对话都直接失败。
      const msg = e instanceof Error ? e.message : String(e);
      hostLog(`computeLake failed: ${msg}`);
      next = emptyLake(msg);
    }
    // 半锁状态下的残缺结果不缓存，下一轮重算。
    if (!next.unstable) {
      cachedLake = next;
      cachedLakeAt = now;
    }
    return next;
  }

  // --- Persona + lake context（systemPrompt 不是可注入服务，按 meow-memory 的做法轮询取）---
  const attachPromptParts = (attempt = 0) => {
    try {
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

      // 只读一次种子文件，注册与日志共用同一份文本。
      const personaText = assemblePersona(home);
      if (personaText) {
        safe('persona', () => svc.section({
          name: 'dsh-lakemind:persona',
          order: 50, // 在 harness 身份(-1000)与部署人格前缀(0)之后、工具说明之前
          text: personaText,
        }));
      }

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

      hostLog(`prompt parts attached (personaChars=${personaText.length})`);
    } catch (e) {
      hostLog(`attachPromptParts failed: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    }
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
            // 注意：DSH 的 schema 校验只接受 additionalProperties: false|true，
            // 写成子 schema（additionalProperties: { type: 'number' }）会让整个工具注册失败。
            bands: {
              type: 'object',
              additionalProperties: false,
              properties: {
                core: { type: 'number' },
                spine: { type: 'number' },
                recent: { type: 'number' },
                surface: { type: 'number' },
                foam: { type: 'number' },
              },
            },
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
        const bands = {};
        for (const b of BANDS) bands[b.name] = Number((lake.bandBrightness[b.id] || 0).toFixed(2));
        const top = [...lake.ripples]
          .filter((r) => r.status !== 'archived')
          .sort((a, b) => b.weight - a.weight)
          .slice(0, limit)
          .map((r) => ({ id: r.id, level: r.level, bandName: r.bandName, weight: Number(r.weight.toFixed(4)), title: String(r.title || r.content || '').slice(0, 60) }));
        return { total: lake.total, bands, top };
      },
    };
    return ctx.tools.register(tool);
  }, 'dsh-lakemind: glimpse tool'));

  // --- HTTP API for client -------------------------------------------------
  // 用 exact 路由（image-gen 等插件的写法），每个端点单独注册；prefix 匹配在桌面端不稳。
  const sendJson = (res, status, obj) => {
    if (res.writableEnded) return;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    // 面板每 5 秒轮询一次 /state，不显式禁缓存的话浏览器可能一直拿到旧湖面。
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  const MAX_BODY_BYTES = 256 * 1024;
  async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      // 不设上限就是把内存交给请求方，一个超大 body 能把宿主拖死。
      if (size > MAX_BODY_BYTES) {
        const err = new Error('body too large');
        err.statusCode = 413;
        throw err;
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      const err = new Error('invalid json');
      err.statusCode = 400;
      throw err;
    }
  }

  const registerRoute = (routePath, methods, handler) => {
    safe(`route ${routePath}`, () => ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (req, res) => {
        const method = (req.method || 'GET').toUpperCase();
        if (methods && !methods.includes(method)) {
          res.setHeader('allow', methods.join(', '));
          return sendJson(res, 405, { error: 'method not allowed' });
        }
        try {
          await handler(req, res, method);
        } catch (e) {
          const status = Number(e && e.statusCode) || 500;
          if (status >= 500) hostLog(`route ${routePath} threw: ${e instanceof Error ? e.stack || e.message : String(e)}`);
          try {
            sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
          } catch {}
        }
      },
    }), `dsh-lakemind: route ${routePath}`));
  };

  // 同一处报错反复上报（例如某个槽位每次渲染都炸）只记一条，避免诊断日志被刷爆。
  const diagSeen = new Map();
  const DIAG_DEDUPE_MS = 5 * 60 * 1000;

  registerRoute('/lakemind-7350/state', ['GET'], async (req, res) => {
    const lake = getLake();
    // 只发画布真正要用的字段。完整记忆原文留在宿主侧——
    // 之前每条记忆的 content/title 都跟着轮询发到浏览器，一次 26KB、其中 12.9K 字是私人内容。
    const lite = {
      total: lake.total,
      dbPath: lake.dbPath,
      dbPaths: lake.dbPaths,
      bandBrightness: lake.bandBrightness,
      sqliteError: lake.sqliteError,
      computedAt: lake.computedAt,
      ripples: lake.ripples.map((r) => ({
        id: r.id,
        status: r.status,
        radius: Number(r.radius.toFixed(4)),
        weight: Number(r.weight.toFixed(4)),
        angle: Number(r.angle.toFixed(4)),
        hue: r.hue,
        bandName: r.bandName,
      })),
    };
    const persona = assemblePersona(home);
    sendJson(res, 200, { lake: lite, personaPreview: persona.slice(0, 400), home, roots: workspaceRoots() });
  });

  // 允许写进 state.json 的键白名单：之前是把请求体整份展开合并，
  // 客户端传什么都会原样落盘，包括垃圾键和嵌套对象。
  const ALLOWED_CONFIG_KEYS = ['heartbeatMinutes', 'cooldownMinutes', 'speakUp', 'quietHours'];

  registerRoute('/lakemind-7350/config', ['GET', 'POST'], async (req, res, method) => {
    if (method === 'GET') return sendJson(res, 200, loadState(home));
    const parsed = await readJsonBody(req);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return sendJson(res, 400, { error: 'body must be an object' });
    }
    const patch = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      const value = parsed[key];
      if (value === undefined || value === null) continue;
      if (key === 'speakUp') {
        patch[key] = Boolean(value);
      } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        patch[key] = value;
      }
    }
    const next = { ...loadState(home), ...patch, updatedAt: Date.now() };
    saveState(home, next);
    return sendJson(res, 200, next);
  });

  const MAX_SEED_BYTES = 64 * 1024;

  registerRoute('/lakemind-7350/seed', ['GET', 'POST'], async (req, res, method) => {
    if (method === 'GET') return sendJson(res, 200, { seed: loadSeed(home) });
    const parsed = await readJsonBody(req);
    if (!parsed || typeof parsed.seed !== 'string') {
      return sendJson(res, 400, { error: 'seed must be a string' });
    }
    if (Buffer.byteLength(parsed.seed, 'utf8') > MAX_SEED_BYTES) {
      return sendJson(res, 413, { error: 'seed too large' });
    }
    // 原来只有 GET：设置页里改的人格点保存后其实什么都没写进去，等于白改。
    writeFileSync(seedFile(home), parsed.seed, 'utf8');
    return sendJson(res, 200, { ok: true, chars: parsed.seed.length });
  });

  registerRoute('/lakemind-7350/diag', ['POST'], async (req, res) => {
    const parsed = await readJsonBody(req).catch(() => null);
    if (parsed) {
      const key = `${parsed.where || parsed.stage || '?'}|${String(parsed.message || parsed.extra || '').slice(0, 200)}`;
      const last = diagSeen.get(key) || 0;
      if (Date.now() - last < DIAG_DEDUPE_MS) {
        return sendJson(res, 200, { ok: true, deduped: true });
      }
      diagSeen.set(key, Date.now());
      if (diagSeen.size > 200) diagSeen.clear();
    }
    appendLogRotating(
      join(home, 'logs', 'client-diag.log'),
      `${new Date().toISOString()} ${parsed ? JSON.stringify(parsed).slice(0, 6000) : '(unparsable diag)'}\n`,
    );
    sendJson(res, 200, { ok: true });
  });

  hostLog(`apply done (routes registered, roots=${JSON.stringify(workspaceRoots())})`);
}

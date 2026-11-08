// 宿主侧自检：用假的 ctx / req / res 把每个 HTTP 路由与工具真跑一遍。
// 不需要 Electron，也不需要 DSH 在跑；记忆库是本测试自己造的临时库。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..');
const TEST_HOME = mkdtempSync(join(tmpdir(), 'lakemind-test-'));
const WORKSPACE = join(TEST_HOME, 'ws');
process.env.LAKEMIND_HOME = TEST_HOME;
process.env.DSH_HOME = join(TEST_HOME, 'dsh');

// ---- 造一个 meow-memory 形状的记忆库 ------------------------------------
const dbDir = join(WORKSPACE, '.dsh-meow');
mkdirSync(dbDir, { recursive: true });
const dbPath = join(dbDir, 'memory.db');
{
  const db = new DatabaseSync(dbPath);
  const cols = `id text primary key, title text, content text, importance integer, keywords text,
    status text, hit_count integer, created_at integer, updated_at integer, last_accessed_at integer, project text`;
  db.exec(`create table fact (${cols})`);
  db.exec(`create table lesson (${cols})`);
  db.exec(`create table dream_log (x text)`); // 干扰表：不该被当成记忆表
  const now = Date.now();
  const insert = db.prepare('insert into fact (id, title, content, importance, keywords, status, hit_count, created_at, updated_at, project) values (?,?,?,?,?,?,?,?,?,?)');
  insert.run('m-1', '第一条', '正文一', 4, JSON.stringify(['甲', '乙']), 'active', 0, now, now, 'demo');
  insert.run('m-2', '第二条', '正文二', 2, JSON.stringify(['丙']), 'active', 2, now, now, 'demo');
  insert.run('m-3', '已归档', '不该出现', 3, JSON.stringify(['丁']), 'archived', 0, now, now, 'demo');
  db.prepare('insert into lesson (id, title, content, importance, keywords, status, hit_count, created_at, updated_at, project) values (?,?,?,?,?,?,?,?,?,?)')
    .run('m-4', '教训一条', '正文四', 3, 'not-json-keywords', 'active', 0, now, now, 'demo');
  db.close();
}

const results = [];
function check(label, cond, detail) {
  results.push({ label, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  <-- ' + (detail || '')}`);
}

// ---- 假的宿主环境 -------------------------------------------------------
const routes = new Map();
const tools = [];
const sections = [];
const contexts = [];

const webServerSvc = {
  register(spec) {
    routes.set(spec.path, spec);
    return () => routes.delete(spec.path);
  },
};
const toolsSvc = {
  register(tool) {
    tools.push(tool);
    return () => {};
  },
};
const promptSvc = {
  section(s) { sections.push(s); return () => {}; },
  context(c) { contexts.push(c); return () => {}; },
};

const ctx = {
  webServer: webServerSvc,
  tools: toolsSvc,
  systemPrompt: promptSvc,
  get(name) {
    if (name === 'webServer') return webServerSvc;
    if (name === 'tools') return toolsSvc;
    if (name === 'systemPrompt') return promptSvc;
    if (name === 'workspaceRegistry') return { list: () => [{ record: { path: WORKSPACE, title: 'ws' } }] };
    return undefined;
  },
  effect(fn) { return fn(); },
  logger: { warn() {} },
};

function makeReq({ method = 'GET', body = '' } = {}) {
  const req = { method };
  req[Symbol.asyncIterator] = async function* () {
    if (body) yield Buffer.from(body, 'utf8');
  };
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    end(chunk) { this.body = chunk || ''; this.writableEnded = true; },
  };
}

async function call(path, opts) {
  const route = routes.get(path);
  if (!route) throw new Error('route not registered: ' + path);
  const req = makeReq(opts);
  const res = makeRes();
  await route.handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

// ---- 启动插件 -----------------------------------------------------------
const mod = await import(pathToFileURL(join(ROOT, 'index.js')).href);
check('导出 name', mod.name === 'dsh-lakemind', mod.name);
mod.apply(ctx, {});
await new Promise((r) => setTimeout(r, 60)); // 等 systemPrompt 轮询回调

check('注册了 4 个路由', routes.size === 4, [...routes.keys()].join(','));
check('注册了 glimpse 工具', tools.length === 1 && tools[0].name === 'lakemind_glimpse', String(tools.length));
check('人格 section 已注入', sections.length === 1 && sections[0].text.length > 0, String(sections.length));
check('湖面 context 已注入', contexts.length === 1, String(contexts.length));

const summary = typeof contexts[0]?.text === 'function' ? contexts[0].text() : '';
check('湖面摘要是一行', summary.startsWith('记忆湖：') && !summary.includes('\n'), summary);
check('摘要数字对得上（3 条 active）', summary.includes('3 条涟漪'), summary);

// ---- /state -------------------------------------------------------------
{
  const r = await call('/lakemind-7350/state');
  check('state 200', r.status === 200, r.status);
  check('state 禁缓存', r.headers['cache-control'] === 'no-store', r.headers['cache-control']);
  const lake = r.json.lake;
  check('state 只算 active（3 条）', lake.total === 3, lake.total);
  check('state 排除了干扰表', !lake.ripples.some((x) => String(x.id).startsWith('dream')), '');
  const keys = Object.keys(lake.ripples[0] || {});
  check('state 不下发 content', !keys.includes('content'), keys.join(','));
  check('state 不下发 title', !keys.includes('title'), keys.join(','));
  check('state 字段齐全', ['id', 'radius', 'weight', 'angle', 'hue', 'bandName'].every((k) => k in (lake.ripples[0] || {})), keys.join(','));
  check('state 体积很小', r.raw.length < 2 * 1024, r.raw.length + ' bytes');
}

// ---- /config ------------------------------------------------------------
{
  const r0 = await call('/lakemind-7350/config');
  check('config GET 200', r0.status === 200);

  const r1 = await call('/lakemind-7350/config', { method: 'POST', body: JSON.stringify({ heartbeatMinutes: 25, cooldownMinutes: 45, speakUp: false }) });
  check('config 写入 200', r1.status === 200, r1.status);
  check('config 存下心跳', r1.json.heartbeatMinutes === 25, r1.json.heartbeatMinutes);
  check('config 存下冷却', r1.json.cooldownMinutes === 45, r1.json.cooldownMinutes);
  check('config 存下开关', r1.json.speakUp === false, r1.json.speakUp);

  const r2 = await call('/lakemind-7350/config', { method: 'POST', body: JSON.stringify({ evilKey: 'x', nested: { a: 1 }, heartbeatMinutes: -5 }) });
  check('config 丢弃白名单外的键', r2.json.evilKey === undefined && r2.json.nested === undefined, JSON.stringify(r2.json));
  check('config 拒绝非法数值', r2.json.heartbeatMinutes === 25, r2.json.heartbeatMinutes);

  const r3 = await call('/lakemind-7350/config', { method: 'POST', body: '{not json' });
  check('config 坏 JSON → 400', r3.status === 400, r3.status);

  const r4 = await call('/lakemind-7350/config', { method: 'POST', body: 'x'.repeat(300 * 1024) });
  check('config 超大 body → 413', r4.status === 413, r4.status);

  const r5 = await call('/lakemind-7350/config', { method: 'DELETE' });
  check('config 非法方法 → 405', r5.status === 405, r5.status);
  check('config 405 带 allow', !!r5.headers.allow, r5.headers.allow);
}

// ---- /seed --------------------------------------------------------------
{
  const r0 = await call('/lakemind-7350/seed');
  check('seed GET 有内容', r0.json && r0.json.seed.length > 0, (r0.json && r0.json.seed.length) || 0);

  const r1 = await call('/lakemind-7350/seed', { method: 'POST', body: JSON.stringify({ seed: '# 我的人格\n\n这是测试种子。' }) });
  check('seed POST 200', r1.status === 200, r1.status);
  check('seed 真的落盘', readFileSync(join(TEST_HOME, 'persona.seed.md'), 'utf8').includes('这是测试种子'), 'file mismatch');

  const r2 = await call('/lakemind-7350/seed');
  check('seed 读回一致', r2.json.seed.includes('这是测试种子'), r2.json.seed.slice(0, 40));

  const r3 = await call('/lakemind-7350/seed', { method: 'POST', body: JSON.stringify({ seed: 123 }) });
  check('seed 非字符串 → 400', r3.status === 400, r3.status);

  const r4 = await call('/lakemind-7350/seed', { method: 'POST', body: JSON.stringify({ seed: 'y'.repeat(70 * 1024) }) });
  check('seed 超大 → 413', r4.status === 413, r4.status);
}

// ---- /diag --------------------------------------------------------------
{
  const body = JSON.stringify({ where: 'test', message: 'boom', stack: 'x'.repeat(50) });
  const r1 = await call('/lakemind-7350/diag', { method: 'POST', body });
  check('diag 200', r1.status === 200, r1.status);
  const r2 = await call('/lakemind-7350/diag', { method: 'POST', body });
  check('diag 去重生效', r2.json && r2.json.deduped === true, JSON.stringify(r2.json));

  const logPath = join(TEST_HOME, 'logs', 'client-diag.log');
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  check('diag 只写一条', text.split('\n').filter(Boolean).length === 1, text.split('\n').filter(Boolean).length);
}

// ---- 工具 ---------------------------------------------------------------
{
  const tool = tools[0];
  check('工具参数 schema 合法', tool.parameters.additionalProperties === false);
  const out = await tool.execute({ limit: 2 });
  check('工具返回 total', out.total === 3, out.total);
  check('工具 bands 五个环带齐全', ['core', 'spine', 'recent', 'surface', 'foam'].every((k) => typeof out.bands[k] === 'number'), JSON.stringify(out.bands));
  check('工具 top 受 limit 限制', out.top.length === 2, out.top.length);
  check('工具 top 字段齐全', ['id', 'level', 'bandName', 'weight', 'title'].every((k) => k in out.top[0]), JSON.stringify(out.top[0]));
  const rendered = tool.output.render({}, out);
  check('工具 render 可用', Array.isArray(rendered) && rendered[0].text.includes('涟漪'), JSON.stringify(rendered).slice(0, 80));
}

// ---- 容错 ---------------------------------------------------------------
{
  // 把库换成一个坏文件。注意湖面有 15 秒缓存，必须重新 apply 一份新实例才读得到。
  writeFileSync(dbPath, 'this is not a sqlite database');
  routes.clear();
  sections.length = 0;
  contexts.length = 0;
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 60));

  const r = await call('/lakemind-7350/state');
  check('坏库时 state 仍 200', r.status === 200, r.status);
  check('坏库时湖面为空', r.json.lake.total === 0, r.json.lake.total);
  check('坏库时有报错字段', typeof r.json.lake.sqliteError === 'string' && r.json.lake.sqliteError.length > 0, r.json.lake.sqliteError);
  const s2 = typeof contexts[0]?.text === 'function' ? contexts[0].text() : '';
  check('坏库时摘要不抛异常', typeof s2 === 'string' && s2.length > 0, s2);
  check('坏库时摘要说没涟漪', s2.includes('暂无涟漪'), s2);
}

rmSync(TEST_HOME, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(' - ' + f.label + ' :: ' + (f.detail || ''));
  process.exit(1);
}

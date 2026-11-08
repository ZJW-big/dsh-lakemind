// lake-core 纯函数自检（不依赖宿主）
import {
  BANDS,
  importanceToRadius,
  bandOfRadius,
  computeWeight,
  keywordAngle,
  keywordJitter,
  levelHue,
  buildRipple,
  aggregateBandBrightness,
} from '../lake-core.js';

let pass = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fails.push(label + (detail === undefined ? '' : ' :: ' + detail));
    console.log('FAIL  ' + label + (detail === undefined ? '' : '  <-- ' + detail));
  }
}

const mem = (over = {}) => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  level: 'fact',
  status: 'active',
  importance: 2,
  keywords: ['a'],
  created_at: Date.now(),
  updated_at: Date.now(),
  last_accessed_at: null,
  hit_count: 0,
  content: 'c',
  title: 't',
  ...over,
});

// ---- 半径映射 ----
ok('importance 4 → 半径 0', importanceToRadius(4) === 0);
ok('importance 1 → 半径 0.75', importanceToRadius(1) === 0.75);
ok('importance 越界会被夹住', importanceToRadius(99) === 0 && importanceToRadius(-3) === 0.75);
ok('importance 脏值当成 1', importanceToRadius('abc') === 0.75 && importanceToRadius(null) === 0.75);

// ---- 环带边界 ----
for (const b of BANDS) {
  ok(`band ${b.name} 左边界命中`, bandOfRadius(b.rMin).id === b.id, 'r=' + b.rMin);
}
ok('半径 1.0 归到最外层', bandOfRadius(1).id === BANDS[BANDS.length - 1].id);

// ---- 权重 ----
ok('内核不衰减', computeWeight({ createdAt: Date.now() - 3650 * 86400000, bandHalfLifeDays: Infinity }) === 1);
ok('没有时间戳 → 0', computeWeight({ bandHalfLifeDays: 45 }) === 0);
const fresh = computeWeight({ updatedAt: Date.now(), bandHalfLifeDays: 45 });
const old = computeWeight({ updatedAt: Date.now() - 90 * 86400000, bandHalfLifeDays: 45 });
ok('旧记忆权重更低', old < fresh, `${old} < ${fresh}`);
ok('半衰期 45 天过 90 天应剩约 1/4', Math.abs(old - 0.25) < 0.02, old);
ok('召回会提权', computeWeight({ updatedAt: Date.now(), bandHalfLifeDays: 45, recallCount: 4 }) > fresh);

// ---- 散列 ----
ok('角度稳定', Math.abs(keywordAngle(['x', 'y']) - keywordAngle(['x', 'y'])) < 1e-12);
ok('不同关键词角度不同', keywordAngle(['x']) !== keywordAngle(['y']));
ok('角度是连续值', new Set(Array.from({ length: 50 }, (_, i) => keywordAngle(['k' + i]))).size === 50);
ok('抖动落在 0..1', (() => {
  for (let i = 0; i < 200; i++) {
    const v = keywordJitter(['k' + i]);
    if (!(v >= 0 && v <= 1)) return false;
  }
  return true;
})());

// ---- 层级配色 ----
ok('已知层级有颜色', levelHue('soul') === 45 && levelHue('PROJECT') === 200);
ok('未知层级有兜底', levelHue('nope') === 220 && levelHue(undefined) === 220);

// ---- 同分记忆必须散开 ----
const same = Array.from({ length: 50 }, (_, i) => buildRipple(mem({ keywords: ['kw' + i] })));
ok('同重要度半径各不相同', new Set(same.map((r) => r.radius)).size === 50, new Set(same.map((r) => r.radius)).size);
ok('同重要度都留在同一环带', new Set(same.map((r) => r.bandId)).size === 1);

// 没有关键词时若都退回空串，会精确叠在同一个点上
const noKw = Array.from({ length: 30 }, () => buildRipple(mem({ keywords: [], id: 'u-' + Math.random().toString(36).slice(2) })));
ok('无关键词半径不重叠', new Set(noKw.map((r) => r.radius)).size === 30, new Set(noKw.map((r) => r.radius)).size);
ok('无关键词角度不重叠', new Set(noKw.map((r) => r.angle)).size === 30);

// ---- 环带亮度聚合 ----
const agg = aggregateBandBrightness([
  { bandId: 0, weight: 1, status: 'active' },
  { bandId: 0, weight: 2, status: 'active' },
  { bandId: 4, weight: 5, status: 'archived' },
]);
ok('亮度按环带累加', agg.get(0) === 3, agg.get(0));
ok('archived 不计入', agg.get(4) === 0, agg.get(4));
ok('五个环带都有键', BANDS.every((b) => agg.has(b.id)));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);

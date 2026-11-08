// dsh-lakemind 纯函数核心：涟漪模型、权重、布局、关键词哈希。
// 零 Node / Cordis 依赖，可在任意环境单测。

export const BANDS = [
  { id: 0, rMin: 0.00, rMax: 0.15, name: 'core', halfLifeDays: Infinity },
  { id: 1, rMin: 0.15, rMax: 0.35, name: 'spine', halfLifeDays: 180 },
  { id: 2, rMin: 0.35, rMax: 0.60, name: 'recent', halfLifeDays: 45 },
  { id: 3, rMin: 0.60, rMax: 0.85, name: 'surface', halfLifeDays: 14 },
  { id: 4, rMin: 0.85, rMax: 1.00, name: 'foam', halfLifeDays: 4 },
];

const LEVEL_HUE = {
  soul: 45,
  user: 45,
  project: 200,
  rules: 270,
  fact: 0,
  lesson: 35,
  topic: 170,
};

export function importanceToRadius(importance) {
  const imp = Math.max(1, Math.min(4, Number(importance) || 1));
  return Math.max(0, Math.min(1, (4 - imp) / 4));
}

export function bandOfRadius(r) {
  for (const b of BANDS) {
    if (r >= b.rMin && r < b.rMax) return b;
  }
  return BANDS[BANDS.length - 1];
}

export function computeWeight({ createdAt, updatedAt, lastAccessedAt, bandHalfLifeDays, recallCount }) {
  const ref = Math.max(Number(createdAt) || 0, Number(updatedAt) || 0, Number(lastAccessedAt) || 0);
  if (!ref) return 0;
  const days = Math.max(0, (Date.now() - ref) / 86_400_000);
  if (!Number.isFinite(bandHalfLifeDays)) return 1; // core band never decays
  const decay = Math.exp(-Math.LN2 * days / bandHalfLifeDays);
  const recallBoost = Math.pow(1 + 0.35 * Math.max(0, Number(recallCount) || 0), 0.5);
  return decay * recallBoost;
}

/** Stable angle from keywords so the same memory always sits at the same spot. */
export function keywordAngle(keywords) {
  const str = Array.isArray(keywords) ? keywords.join('|') : String(keywords || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // 用整个 32 位的比值而不是 h % 360：离散成 360 档时，
  // 几十条记忆里必然撞角，两条会精确叠在同一个点上。
  return (h / 4294967296) * Math.PI * 2;
}

export function levelHue(level) {
  return LEVEL_HUE[String(level).toLowerCase()] ?? 220;
}

/**
 * 稳定散列出 0..1 的小数，用来在同一条环带里给记忆一点半径抖动。
 * 没有它时 importance 只会映射出 4 个固定半径，同分记忆会挤成一条正圆，
 * 几十个光点叠在一起看着像噪点而不是涟漪。
 */
export function keywordJitter(keywords) {
  const str = Array.isArray(keywords) ? keywords.join('|') : String(keywords || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % 1000000) / 1000000;
}

export function buildRipple(memory) {
  const baseRadius = importanceToRadius(memory.importance);
  const band = bandOfRadius(baseRadius);
  const weight = computeWeight({
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    lastAccessedAt: memory.last_accessed_at,
    bandHalfLifeDays: band.halfLifeDays,
    recallCount: memory.hit_count,
  });
  // 没有关键词的记忆若都退回空串，散列结果完全相同，这一批会精确叠在同一个点上。
  // 所以退到 id，再退到标题/正文。
  const hasKeywords = Array.isArray(memory.keywords) && memory.keywords.length > 0;
  const seed = hasKeywords
    ? memory.keywords
    : String(memory.id || memory.title || memory.content || '');
  const angle = keywordAngle(seed);
  // 环带由 importance 决定（语义不变），带内的具体半径由这个种子稳定散列决定
  const jitter = keywordJitter(seed);
  const radius = Math.max(0, Math.min(1, band.rMin + (band.rMax - band.rMin) * jitter));
  return {
    id: memory.id,
    level: memory.level,
    status: memory.status,
    importance: memory.importance,
    radius,
    baseRadius,
    bandId: band.id,
    bandName: band.name,
    weight,
    angle,
    hue: levelHue(memory.level),
    content: memory.content,
    title: memory.title,
  };
}

export function aggregateBandBrightness(ripples) {
  const out = new Map();
  for (const b of BANDS) out.set(b.id, 0);
  for (const r of ripples) {
    if (r.status === 'archived') continue;
    out.set(r.bandId, (out.get(r.bandId) || 0) + r.weight);
  }
  return out;
}

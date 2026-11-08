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
  return (h % 360) * (Math.PI / 180);
}

export function levelHue(level) {
  return LEVEL_HUE[String(level).toLowerCase()] ?? 220;
}

export function buildRipple(memory) {
  const r = importanceToRadius(memory.importance);
  const band = bandOfRadius(r);
  const weight = computeWeight({
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    lastAccessedAt: memory.last_accessed_at,
    bandHalfLifeDays: band.halfLifeDays,
    recallCount: memory.hit_count,
  });
  const angle = keywordAngle(memory.keywords);
  return {
    id: memory.id,
    level: memory.level,
    status: memory.status,
    importance: memory.importance,
    radius: r,
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

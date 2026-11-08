// dsh-lakemind client 半边：湖面渲染 + 设置页。
// 约束：这是宿主按普通脚本方式加载的产物，只能使用 __ModuleLoader__ 提供的静态模块
// （react / react/jsx-runtime …）。**不能** require 相对路径文件，所以文案全部内联。
// 整份产物包在 IIFE 里（与 dsh-pet 一致）：避免顶层 const 泄漏到宿主脚本作用域，
// 也避免同一个 bundle 被重复执行时二次声明报错。

;(() => {

const LM_NS = 'dsh-lakemind';

// 阶段打点：浏览器控制台看不到，只能把每一步回传给宿主落盘。
// 启动失败时，日志里走到哪一步就知道死在哪一环。
function lmTrace(stage, extra) {
  try {
    if (typeof fetch !== 'function') return;
    fetch('/lakemind-7350/diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: String(stage), extra: extra === undefined ? '' : String(extra).slice(0, 3000), at: Date.now() }),
    }).catch(function () {});
  } catch (e) { /* 打点本身不许抛 */ }
}

lmTrace('module-evaluated');

try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', function (ev) {
      lmTrace('window-error', ev && ev.message ? ev.message : 'unknown');
    });
    window.addEventListener('unhandledrejection', function (ev) {
      const r = ev && ev.reason;
      lmTrace('unhandled-rejection', r && r.message ? r.message : String(r));
    });
  }
} catch (e) { /* 忽略 */ }

const LM_ZH = {
  nav: '记忆湖',
  panelTitle: '涟漪记忆湖',
  open: '记忆湖',
  back: '返回对话',
  backTitle: '返回对话（Esc）',
  empty: '湖面还是空的，等记忆慢慢长进来。',
  settingsTitle: '涟漪记忆湖',
  seedLabel: '种子人格（你可以直接编辑）',
  seedHint: '种子人格在 ~/.dsh/lakemind/persona.seed.md 里编辑',
  heartbeat: '心跳间隔（分钟）',
  cooldown: '主动发言冷却（分钟）',
  speakUp: '允许主动找你说话',
  save: '保存',
  saved: '已保存',
  saveFailed: '保存失败',
  lakeEmpty: '湖面还是空的，等记忆慢慢长进来。',
  band0: '内核',
  band1: '骨架',
  band2: '近期',
  band3: '表层',
  band4: '浮沫',
};

const LM_EN = {
  nav: 'Memory Lake',
  panelTitle: 'Ripple Memory Lake',
  open: 'Lake',
  back: 'Back to chat',
  backTitle: 'Back to chat (Esc)',
  empty: 'The lake is still empty. Memories will grow in over time.',
  settingsTitle: 'Ripple Memory Lake',
  seedLabel: 'Seed persona (editable)',
  seedHint: 'Edit the seed at ~/.dsh/lakemind/persona.seed.md',
  heartbeat: 'Heartbeat interval (minutes)',
  cooldown: 'Proactive speak cooldown (minutes)',
  speakUp: 'Allow proactive messages',
  save: 'Save',
  saved: 'Saved',
  saveFailed: 'Save failed',
  lakeEmpty: 'The lake is still empty. Memories will grow in over time.',
  band0: 'Core',
  band1: 'Spine',
  band2: 'Recent',
  band3: 'Surface',
  band4: 'Foam',
};

const LM_CSS = [
  // ---- 湖面主面板 ----
  '.lm-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#0b0f18);color:var(--dsw-alias-label-primary,#e6edf3)}',
  '.lm-wrap{position:relative;flex:1;min-height:0;overflow:hidden}',
  '.lm-canvas{width:100%;height:100%;display:block}',
  '.lm-hud{position:absolute;left:14px;bottom:12px;font-size:12px;opacity:.7;pointer-events:none;line-height:1.5;font-variant-numeric:tabular-nums}',
  '.lm-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.55;font-size:14px}',
  '.lm-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#242a38);font-size:13px}',
  '.lm-top .lm-title{font-weight:600}',
  '.lm-back{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8dde6);color:var(--dsw-alias-label-secondary,#8b98ad);border-radius:7px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;transition:color .15s,border-color .15s}',
  '.lm-back:hover{border-color:rgba(212,168,83,.7);color:#f0d089}',
  '.lm-back .lm-esc{opacity:.55;font-size:10.5px}',

  // ---- 设置页：土星夜景（深空底 + 冷白字 + 金色点缀）----
  '.lm-settings{display:flex;flex-direction:column;gap:16px;max-width:640px;padding:20px 22px 26px;border-radius:14px;background:radial-gradient(120% 120% at 15% 0%,#141c2e 0%,#0a0e17 55%,#070a11 100%);border:1px solid rgba(200,170,90,.22);box-shadow:0 8px 28px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);color:#e8eef7;font-size:13px;line-height:1.6}',
  '.lm-settings .lm-head{display:flex;flex-direction:column;gap:5px}',
  '.lm-settings .lm-title-lg{margin:0;font-size:17px;font-weight:600;letter-spacing:.3px;color:#f2dfae;text-shadow:0 0 14px rgba(242,223,174,.35)}',
  '.lm-settings .lm-sub{margin:0;font-size:12px;color:#8fa0bd}',
  '.lm-settings .lm-bands{display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 12px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}',
  '.lm-settings .lm-preview{position:relative;height:230px;border-radius:11px;overflow:hidden;border:1px solid rgba(120,150,200,.22);background:#080b12;box-shadow:inset 0 0 30px rgba(0,0,0,.6)}',
  '.lm-settings .lm-band{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#a9b8d0;font-variant-numeric:tabular-nums}',
  '.lm-settings .lm-band-dot{width:7px;height:7px;border-radius:50%;display:inline-block;box-shadow:0 0 7px currentColor}',
  '.lm-settings .lm-field{display:flex;flex-direction:column;gap:6px}',
  '.lm-settings label{font-size:12px;color:#93a4c2}',
  '.lm-settings textarea,.lm-settings input[type=number]{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;font:inherit;color:#dfe8f5;background:rgba(10,16,28,.85);border:1px solid rgba(120,150,200,.28);outline:none;transition:border-color .15s,box-shadow .15s}',
  '.lm-settings textarea{resize:vertical;line-height:1.7}',
  '.lm-settings textarea:focus,.lm-settings input[type=number]:focus{border-color:rgba(212,168,83,.75);box-shadow:0 0 0 3px rgba(212,168,83,.15)}',
  '.lm-settings .lm-hint{margin:0;font-size:11px;color:#6f7f9c}',
  '.lm-settings .lm-row{display:flex;gap:14px;flex-wrap:wrap}',
  '.lm-settings .lm-row>.lm-field{flex:1;min-width:150px}',
  '.lm-settings .lm-check{display:flex;align-items:center;gap:9px;font-size:12.5px;color:#c3cfe2;cursor:pointer}',
  '.lm-settings .lm-check input{width:15px;height:15px;accent-color:#d4a853}',
  '.lm-settings .lm-actions{display:flex;align-items:center;gap:12px;margin-top:2px}',
  '.lm-settings .lm-btn{border:none;border-radius:8px;padding:8px 20px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:#1a1305;background:linear-gradient(135deg,#f0d089 0%,#d4a853 55%,#b8860b 100%);box-shadow:0 2px 10px rgba(212,168,83,.28);transition:transform .12s,box-shadow .15s}',
  '.lm-settings .lm-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(212,168,83,.4)}',
  '.lm-settings .lm-btn:active{transform:translateY(0)}',
  '.lm-settings .lm-status{font-size:12px;color:#9fb0cc}',

  // ---- 会话顶栏小入口 ----
  '.lm-chip{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8dde6);color:var(--dsw-alias-label-secondary,#5b667a);border-radius:999px;padding:3px 11px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;transition:color .15s,border-color .15s}',
  '.lm-chip:hover{color:var(--dsw-alias-label-primary,#1a1a1a);border-color:var(--dsw-alias-border-l3,#b8c0cc)}',
].join('\n');

function makeFactory() {
  return function factory(require) {
    const React = require('react');
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const jsxRuntime = require('react/jsx-runtime');
    const rawJsx = jsxRuntime.jsx;
    const Fragment = jsxRuntime.Fragment;

    // 关键：react/jsx-runtime 的 jsx(type, props, key) 第三个参数是 key，不是 children。
    // 直接 h(tag, props, '文字') 会把这些内容当成 key 静默丢弃（只留下样式背景，看不到任何文字）。
    // 这里包一层，把可变参数收进 props.children，与 React.createElement 的语义一致。
    function h(type, props) {
      const merged = {};
      if (props !== null && props !== undefined) {
        for (const k in props) merged[k] = props[k];
      }
      const kids = [];
      for (let i = 2; i < arguments.length; i++) {
        const child = arguments[i];
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c !== null && c !== undefined && c !== false) kids.push(c);
          }
        } else {
          kids.push(child);
        }
      }
      if (kids.length === 1) merged.children = kids[0];
      else if (kids.length > 1) merged.children = kids;
      // react/jsx-runtime 要求 key 作为第三个参数传入，放在 props 里会触发告警
      const key = merged.key;
      if (key !== undefined) delete merged.key;
      return rawJsx(type, merged, key);
    }

    lmTrace('factory-materialized', 'react=' + (typeof React) + ' jsx=' + (typeof jsxRuntime.jsx));

    function t(lang, key) {
      const dict = lang === 'en' ? LM_EN : LM_ZH;
      return dict[key] !== undefined ? dict[key] : key;
    }

    // ---- 湖面 ------------------------------------------------------------
    function LakeCanvas(props) {
      const lake = props.lake;
      const lang = props.lang || 'zh';
      const ref = useRef(null);

      useEffect(function () {
        const cvs = ref.current;
        if (!cvs) return undefined;
        const g = cvs.getContext('2d');
        if (!g) return undefined;

        let raf = 0;
        let phase = 0;

        function draw() {
          const rect = cvs.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const w = Math.max(1, Math.floor(rect.width * dpr));
          const hh = Math.max(1, Math.floor(rect.height * dpr));
          if (cvs.width !== w || cvs.height !== hh) {
            cvs.width = w;
            cvs.height = hh;
          }
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          const cw = rect.width;
          const ch = rect.height;
          g.clearRect(0, 0, cw, ch);

          const bg = g.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
          bg.addColorStop(0, '#0c1220');
          bg.addColorStop(1, '#06080e');
          g.fillStyle = bg;
          g.fillRect(0, 0, cw, ch);

          const cx = cw / 2;
          const cy = ch / 2;
          const maxR = Math.min(cw, ch) * 0.45;
          const bands = (lake && lake.bandBrightness) || {};
          const bright = [];
          for (let i = 0; i < 5; i++) bright.push(Number(bands[i] || bands[String(i)] || 0));

          const edges = [0.15, 0.35, 0.6, 0.85, 1.0];
          const hues = [45, 200, 170, 270, 220];
          for (let i = 0; i < edges.length; i++) {
            const b = Math.min(1.6, bright[i]);
            const alpha = 0.05 + Math.min(0.42, b * 0.16);
            const breathe = 1 + 0.012 * Math.sin(phase * 0.9 + i);
            g.beginPath();
            g.arc(cx, cy, maxR * edges[i] * breathe, 0, Math.PI * 2);
            g.strokeStyle = 'hsla(' + hues[i] + ', 70%, 68%, ' + alpha.toFixed(3) + ')';
            g.lineWidth = 1 + Math.min(1.6, b * 0.4);
            g.stroke();
          }

          const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 26);
          glow.addColorStop(0, 'rgba(255,222,150,0.95)');
          glow.addColorStop(0.35, 'rgba(255,205,120,0.35)');
          glow.addColorStop(1, 'rgba(255,205,120,0)');
          g.fillStyle = glow;
          g.beginPath();
          g.arc(cx, cy, 26, 0, Math.PI * 2);
          g.fill();
          g.beginPath();
          g.arc(cx, cy, 3.2, 0, Math.PI * 2);
          g.fillStyle = '#fff4d6';
          g.fill();

          const ripples = (lake && lake.ripples) || [];
          const dots = [];
          for (let i = 0; i < ripples.length; i++) {
            const r = ripples[i];
            if (r.status === 'archived') continue;
            const rad = Math.max(0, Math.min(1, r.radius)) * maxR;
            const wgt = Math.max(0, Math.min(1.4, Number(r.weight) || 0));
            // 压暗 + 降饱和：这些是环带上的光尘，不是撒在画面上的白点
            const alpha = 0.10 + Math.min(0.50, wgt * 0.38);
            const size = 1.1 + Math.min(1.7, wgt * 1.3);
            dots.push({
              x: cx + Math.cos(r.angle) * rad,
              y: cy + Math.sin(r.angle) * rad,
              alpha: alpha,
              size: size,
              hue: Number(r.hue) || 220,
              halo: wgt > 0.75,
            });
          }
          for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            if (d.halo) {
              const hr = d.size * 4;
              const halo = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, hr);
              halo.addColorStop(0, 'hsla(' + d.hue + ',90%,66%,' + (d.alpha * 0.28).toFixed(3) + ')');
              halo.addColorStop(1, 'hsla(' + d.hue + ',90%,66%,0)');
              g.fillStyle = halo;
              g.beginPath();
              g.arc(d.x, d.y, hr, 0, Math.PI * 2);
              g.fill();
            }
            g.beginPath();
            g.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            g.fillStyle = 'hsla(' + d.hue + ', 92%, 64%, ' + d.alpha.toFixed(3) + ')';
            g.fill();
          }

          phase += 0.016;
          raf = requestAnimationFrame(draw);
        }

        raf = requestAnimationFrame(draw);
        return function () { cancelAnimationFrame(raf); };
      }, [lake]);

      const bandLine = (function () {
        if (!lake || !lake.bandBrightness) return '';
        const parts = [];
        for (let i = 0; i < 5; i++) {
          const v = Number(lake.bandBrightness[i] || lake.bandBrightness[String(i)] || 0);
          parts.push(t(lang, 'band' + i) + ' ' + v.toFixed(1));
        }
        return parts.join(' · ');
      })();

      return h('div', { className: 'lm-wrap' },
        h('canvas', { ref: ref, className: 'lm-canvas' }),
        (!lake || !lake.total) && h('div', { className: 'lm-empty' }, t(lang, 'empty')),
        h('div', { className: 'lm-hud' },
          (lake ? '涟漪 ' + lake.total : '') + (bandLine ? ' · ' + bandLine : ''),
        ),
      );
    }

    // ---- 主面板 ----------------------------------------------------------
    function LakePanel(props) {
      const lang = props.lang || 'zh';
      const onClose = props.onClose;
      const state = useState(null);
      const lake = state[0];
      const setLake = state[1];
      const errState = useState('');
      const err = errState[0];
      const setErr = errState[1];

      // 主面板占的是 root 的 `main` keyed slot，会把会话界面整个换掉，
      // 会话顶栏那个入口随之消失——所以这里必须自带出口：按钮 + Esc。
      useEffect(function () {
        if (typeof document === 'undefined' || typeof onClose !== 'function') return undefined;
        function onKey(ev) {
          if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) {
            ev.preventDefault();
            onClose();
          }
        }
        document.addEventListener('keydown', onKey);
        return function () { document.removeEventListener('keydown', onKey); };
      }, [onClose]);

      useEffect(function () {
        let alive = true;
        let timer = 0;
        function poll() {
          fetch('/lakemind-7350/state')
            .then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.json();
            })
            .then(function (data) {
              if (!alive) return;
              setLake(data.lake || null);
              setErr('');
            })
            .catch(function (e) {
              if (alive) setErr(e && e.message ? e.message : String(e));
            })
            .then(function () {
              if (alive) timer = setTimeout(poll, 5000);
            });
        }
        poll();
        return function () { alive = false; clearTimeout(timer); };
      }, []);

      return h('div', { className: 'lm-root' },
        h('div', { className: 'lm-top' },
          typeof onClose === 'function'
            ? h('button', {
              type: 'button',
              className: 'lm-back',
              title: t(lang, 'backTitle'),
              onClick: function () { onClose(); },
            }, '← ' + t(lang, 'back'), h('span', { className: 'lm-esc' }, 'Esc'))
            : null,
          h('span', { className: 'lm-title' }, t(lang, 'panelTitle')),
          err ? h('span', { className: 'lm-status', style: { color: '#ff8080' } }, err) : null,
        ),
        h(LakeCanvas, { lake: lake, lang: lang }),
      );
    }

    // ---- 设置页（用工厂函数创建，模仿 dsh-pet 的结构）----------------------
    function makeSettingsPanel(deps) {
      const { h, useState, t, reportDiag, LakeCanvas } = deps;
      function SettingsPanelBody() {
        const translate = function (k) { return t('zh', k); };

        const s1 = useState(null);
        const seed = s1[0];
        const setSeed = s1[1];
        const s2 = useState({});
        const cfg = s2[0];
        const setCfg = s2[1];
        const s3 = useState('');
        const msg = s3[0];
        const setMsg = s3[1];
        const s4 = useState(null);
        const stats = s4[0];
        const setStats = s4[1];
        const s5 = useState(false);
        const loaded = s5[0];
        const setLoaded = s5[1];

        if (!loaded) {
          setLoaded(true);
          Promise.all([
            fetch('/lakemind-7350/seed').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
            fetch('/lakemind-7350/config').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
            fetch('/lakemind-7350/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          ]).then(function (both) {
            if (both[0] && typeof both[0].seed === 'string') setSeed(both[0].seed);
            if (both[1] && typeof both[1] === 'object') setCfg(both[1]);
            if (both[2] && both[2].lake) setStats(both[2].lake);
          });
        }

        function save() {
          fetch('/lakemind-7350/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(cfg),
          })
            .then(function (res) {
              setMsg(res.ok ? translate('saved') : translate('saveFailed') + ' HTTP ' + res.status);
            })
            .catch(function (e) {
              setMsg(translate('saveFailed') + ' ' + (e && e.message ? e.message : String(e)));
            })
            .then(function () {
              setTimeout(function () { setMsg(''); }, 2500);
            });
        }

        const bands = stats && stats.bandBrightness ? stats.bandBrightness : {};
        const bandRow = [0, 1, 2, 3, 4].map(function (i) {
          const v = Number(bands[i] !== undefined ? bands[i] : (bands[String(i)] || 0));
          return h('span', { key: 'b' + i, className: 'lm-band' },
            h('i', { className: 'lm-band-dot', style: { background: 'hsl(' + [45, 200, 170, 270, 220][i] + ',80%,65%)' } }),
            translate('band' + i) + ' ' + v.toFixed(1),
          );
        });

        return h('section', { className: 'lm-settings' },
          h('header', { className: 'lm-head' },
            h('h2', { className: 'lm-title-lg' }, '🪐 ' + translate('settingsTitle')),
            h('p', { className: 'lm-sub' },
              stats && stats.total
                ? stats.total + ' 条记忆 · ' + (stats.dbPaths ? stats.dbPaths.length : 1) + ' 个记忆库'
                : translate('lakeEmpty')),
          ),
          stats && stats.total ? h('div', { className: 'lm-bands' }, bandRow) : null,

          // 湖面预览：设置页里也直接看一眼那圈涟漪，不用再去找主面板入口
          h('div', { className: 'lm-preview' },
            LakeCanvas
              ? h(LakeCanvas, { lake: stats, lang: 'zh' })
              : h('div', { className: 'lm-empty' }, translate('lakeEmpty')),
          ),

          h('div', { className: 'lm-field' },
            h('label', null, translate('seedLabel')),
            h('textarea', {
              rows: 8,
              value: seed === null ? '' : seed,
              placeholder: translate('seedHint'),
              onChange: function (e) { setSeed(e.target.value); },
            }),
            h('p', { className: 'lm-hint' }, translate('seedHint')),
          ),

          h('div', { className: 'lm-row' },
            h('div', { className: 'lm-field' },
              h('label', null, translate('heartbeat')),
              h('input', {
                type: 'number',
                min: 1,
                value: cfg.heartbeatMinutes === undefined ? 10 : cfg.heartbeatMinutes,
                onChange: function (e) {
                  const v = Number(e.target.value);
                  setCfg(Object.assign({}, cfg, { heartbeatMinutes: v > 0 ? v : undefined }));
                },
              }),
            ),
            h('div', { className: 'lm-field' },
              h('label', null, translate('cooldown')),
              h('input', {
                type: 'number',
                min: 1,
                value: cfg.cooldownMinutes === undefined ? 90 : cfg.cooldownMinutes,
                onChange: function (e) {
                  const v = Number(e.target.value);
                  setCfg(Object.assign({}, cfg, { cooldownMinutes: v > 0 ? v : undefined }));
                },
              }),
            ),
          ),

          h('label', { className: 'lm-check' },
            h('input', {
              type: 'checkbox',
              checked: cfg.speakUp !== false,
              onChange: function (e) { setCfg(Object.assign({}, cfg, { speakUp: e.target.checked })); },
            }),
            h('span', null, translate('speakUp')),
          ),

          h('div', { className: 'lm-actions' },
            h('button', { className: 'lm-btn', onClick: save, type: 'button' }, translate('save')),
            msg ? h('span', { className: 'lm-status' }, msg) : null,
          ),
        );
      }

      // 渲染异常兜底：DSH 会把崩溃的槽位换成空占位（页面上就是一片空白），
      // 所以这里自己捕住、把堆栈写给宿主，同时给出可读的错误提示。
      return function SettingsPanel() {
        try {
          return SettingsPanelBody();
        } catch (e) {
          reportDiag('settings-render', e);
          return h('section', { className: 'lm-settings' },
            h('h2', { className: 'lm-title-lg' }, '🪐 记忆湖'),
            h('p', { className: 'lm-sub' }, '渲染失败：' + (e && e.message ? e.message : String(e))),
          );
        }
      };
    }

    // ---- 会话顶栏入口 ----------------------------------------------------
    function LakeChip(props) {
      const lang = props.lang || 'zh';
      return h('button', {
        type: 'button',
        className: 'lm-chip',
        title: t(lang, 'nav'),
        onClick: function () {
          try {
            if (props.openPanel) props.openPanel('lakemind');
          } catch (e) {
            console.warn('[dsh-lakemind] open failed: ' + (e && e.message ? e.message : String(e)));
          }
        },
      }, '🌊 ' + t(lang, 'open'));
    }

    // ---- 插件面 ----------------------------------------------------------
    const name = 'dsh-lakemind';
    const inject = ['slots'];

    // layout 服务是通过 ctx.reflect.provide('layout', …) 挂出去的，不能当依赖注入，
    // 只能运行时按几种可能的口径去取；取不到就让按钮安静失效，绝不让插件加载失败。
    function getLayout(ctx) {
      try {
        if (ctx.layout && typeof ctx.layout.selectPanel === 'function') return ctx.layout;
      } catch (e) { /* ignore */ }
      try {
        if (typeof ctx.get === 'function') {
          const l = ctx.get('layout');
          if (l && typeof l.selectPanel === 'function') return l;
        }
      } catch (e) { /* ignore */ }
      try {
        if (ctx.reflect && typeof ctx.reflect.get === 'function') {
          const l = ctx.reflect.get('layout');
          if (l && typeof l.selectPanel === 'function') return l;
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    // 把客户端侧任何异常（含注册失败）回报给宿主写盘：这是唯一能看到浏览器控制台的途径。
    function reportDiag(where, error) {
      try {
        const body = JSON.stringify({
          where: String(where),
          message: error && error.message ? String(error.message) : String(error),
          stack: error && error.stack ? String(error.stack).slice(0, 4000) : '',
          at: Date.now(),
        });
        if (typeof fetch === 'function') {
          fetch('/lakemind-7350/diag', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body,
          }).catch(function () {});
        }
      } catch (e) { /* 诊断本身失败就算了 */ }
    }

    function apply(ctx) {
      // 整个 apply 兜底：客户端插件抛异常会让 Cordis 把 fiber 标成 failed，
      // 整个 Web boot 随之失败、应用打不开。这里宁可功能缺失也绝不影响启动。
      try {
        let lang = 'zh';
        try {
          const loc = ctx.locale;
          if (loc && typeof loc.current === 'function' && loc.current() === 'en') lang = 'en';
        } catch (e) { /* 保守取中文 */ }

        function openPanel(id) {
          const layout = getLayout(ctx);
          if (!layout) {
            console.warn('[dsh-lakemind] layout service unavailable; cannot open panel');
            return;
          }
          try {
            layout.selectPanel(id);
          } catch (e) {
            reportDiag('open-panel', e);
          }
        }

        // selectPanel(null) 是宿主提供的“回到会话界面”，不改变当前会话。
        function closePanel() {
          const layout = getLayout(ctx);
          if (!layout) return;
          try {
            layout.selectPanel(null);
          } catch (e) {
            reportDiag('close-panel', e);
          }
        }

        // 顶栏入口做成开关：湖面已经开着就收起，否则打开。
        function togglePanel() {
          const layout = getLayout(ctx);
          if (!layout) {
            console.warn('[dsh-lakemind] layout service unavailable; cannot open panel');
            return;
          }
          let active = null;
          try {
            if (layout.panelInfo) active = layout.panelInfo.activePanelId;
          } catch (e) { /* 取不到就当作没开 */ }
          if (active === 'lakemind') closePanel();
          else openPanel('lakemind');
        }

        // 设置页用最成熟的注册方式（meow-memory / dsh-pet / better-sidebar 都这么干），同步注册。
        registerSection(ctx, lang);

        // 主面板与会话顶栏按钮：boot 审计结束之后再挂。即便这里出问题也只是没入口，
        // 绝不会把 fiber 拖进 failed 状态、让整个应用打不开。
        if (typeof setTimeout === 'function') {
          setTimeout(function () {
            try {
              registerPanel(ctx, lang, closePanel);
              registerChip(ctx, lang, togglePanel);
              lmTrace('late-registrations-done');
            } catch (e) {
              reportDiag('late-registrations', e);
            }
          }, 0);
        }
        lmTrace('apply-ok');
      } catch (e) {
        console.warn('[dsh-lakemind] apply failed: ' + (e && e.message ? e.message : String(e)));
        lmTrace('apply-failed', e && e.stack ? e.stack : String(e));
      }
    }

    function registerSection(ctx, lang) {
      try {
        const SettingsPanel = makeSettingsPanel({ h, useState, t, reportDiag, LakeCanvas });
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'lakemind-settings',
          order: 80,
          label: () => t(lang, 'nav'),
        }, SettingsPanel));
      } catch (e) {
        console.warn('[dsh-lakemind] settings section unavailable: ' + (e && e.message ? e.message : String(e)));
        reportDiag('inject:settings', e);
      }
    }

    function registerPanel(ctx, lang, closePanel) {
      try {
        ctx.slots.inject('main', function* () {
          try {
            yield ctx.slots.register(
              { name: 'main', key: 'lakemind' },
              function MainPanelEntry() { return h(LakePanel, { lang: lang, onClose: closePanel }); },
            );
          } catch (e) {
            console.warn('[dsh-lakemind] main panel registration failed: ' + (e && e.message ? e.message : String(e)));
            reportDiag('register:main', e);
          }
        });
      } catch (e) {
        console.warn('[dsh-lakemind] main panel unavailable: ' + (e && e.message ? e.message : String(e)));
        reportDiag('inject:main', e);
      }
    }

    function registerChip(ctx, lang, togglePanel) {
      try {
        ctx.slots.inject('conversation.session.header.utilities', function* () {
          try {
            yield ctx.slots.register(
              { name: 'conversation.session.header.utilities', id: 'lakemind-entry', order: 500 },
              function ChipEntry() { return h(LakeChip, { lang: lang, openPanel: togglePanel }); },
            );
          } catch (e) {
            console.warn('[dsh-lakemind] header chip registration failed: ' + (e && e.message ? e.message : String(e)));
            reportDiag('register:header-chip', e);
          }
        });
      } catch (e) {
        console.warn('[dsh-lakemind] header chip unavailable: ' + (e && e.message ? e.message : String(e)));
        reportDiag('inject:header-chip', e);
      }
    }

    if (typeof document !== 'undefined') {
      try {
        const el = document.createElement('style');
        el.setAttribute('data-dsh-lakemind', '');
        el.textContent = LM_CSS;
        document.head.appendChild(el);
      } catch (e) { /* 样式注入失败不阻塞插件 */ }
    }

    return { name: name, inject: inject, apply: apply };
  };
}

window.__ModuleLoader__.load({ id: LM_NS, factory: makeFactory() });

})();


# dsh-lakemind · 涟漪记忆湖

> 记忆不是列表，是一片湖。重要的事沉在圆心，琐碎的浮在外圈慢慢淡去。

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 做的一个记忆可视化 + 人格注入插件。

它把已有的 `meow-memory` 记忆库读成一片同心涟漪：越靠近圆心越重要，每一圈水波有各自的淡化节奏——内核几乎不动，浮沫几天就散。人格一部分来自你手写的种子，一部分从记忆里长出来。

![设置页](https://gcore.jsdelivr.net/gh/ZJW-big/dsh-lakemind@main/docs/preview.png)

---

## 它在做什么

**涟漪模型。** 每条记忆按 `importance` 落在一条半径上：4 分（最重要）在圆心，1 分在最外圈。五个环带各有自己的半衰期：

| 环带 | 半径 | 半衰期 | 含义 |
| --- | --- | --- | --- |
| 内核 | 0.00–0.15 | 不衰减 | 最核心的事，永不淡去 |
| 骨架 | 0.15–0.35 | 180 天 | 撑住整个人的结构 |
| 近期 | 0.35–0.60 | 45 天 | 最近在想的事 |
| 表层 | 0.60–0.85 | 14 天 | 刚发生、还没沉淀 |
| 浮沫 | 0.85–1.00 | 4 天 | 琐碎，几天就散 |

亮度不是简单衰减，还叠加召回增益：被反复想起的记忆会重新亮起来，并往圆心沉一档。所以湖面是会动的。

**人格三层。** 你手写的 `persona.seed.md` 是底子，原样注入每次对话的系统提示；从记忆里蒸馏出来的"年轮"会慢慢裹上去，时间越久比重越大。

**给模型的工具。** `lakemind_glimpse` —— 让它能"抬头看一眼自己的湖"，拿到各环带亮度和最亮的几条记忆。

---

## 安装

需要 DeepSeek Harness Desktop（0.2.0-rc.2 及以上）。

```bash
# 桌面版 profile 只能手工登记（Electron 独占，CLI 会拒绝写入）
# 1. 把本仓库放到任意目录，例如 F:/deepseek/work/dsh-soulstar
# 2. 在 profile 的 package.json 里加依赖
#    "dsh-lakemind": "file:F:/deepseek/work/dsh-soulstar"
# 3. 把 "dsh-lakemind" 加进 dsh.profile.bundles
# 4. 在 profile 的 cordis.patch.yml 里加：
#    - id: dsh-lakemind
#      name: 'dsh-lakemind'
#      config: {}
# 5. 用 profile 自带的 pnpm 装一次，然后重启应用
```

**一个坑，务必注意：** pnpm 用 `file:` 安装时，`node_modules/<包名>` 指向的是 `.pnpm/` 里的**安装时快照**，不是你改的源码。改完代码不生效时，把那个目录换成指向源码的 junction：

```bat
rmdir /s /q "%DSH_HOME%\profiles\desktop\node_modules\dsh-lakemind"
mklink /J "%DSH_HOME%\profiles\desktop\node_modules\dsh-lakemind" "F:\deepseek\work\dsh-soulstar"
```

客户端插件的改动要**重启宿主进程**才会重新组包（只刷新窗口会继续拿到缓存的旧 bundle）；宿主侧改动同样要重启。

---

## 数据在哪

| 东西 | 位置 |
| --- | --- |
| 记忆库（复用 meow-memory） | `<workspace>/.dsh-meow/memory.db` |
| 种子人格 | `~/.dsh/lakemind/persona.seed.md` |
| 年轮（自我描述） | `~/.dsh/lakemind/persona.emerged.jsonl` |
| 配置 | `~/.dsh/lakemind/state.json` |
| 排查日志 | `~/.dsh/lakemind/logs/` |

本插件**不新建记忆库**，只做只读视图 + 自己的旁路文件，避免和 meow-memory 打架。

HTTP 端点（供前端用）：`/lakemind-7350/state`、`/config`、`/seed`、`/diag`。

`/state` 只下发画布要用的字段（位置、亮度、颜色、环带），**不会**把记忆原文送到浏览器；`/config` 只接收白名单里的键；`/diag` 会去重并按 512 KB 轮转。

---

## 目录

```
index.js           宿主半：读 SQLite、拼人格、注册工具与 HTTP
client.js          浏览器半：设置页 + 湖面画布
lake-core.js       纯函数：半径 / 权重 / 布局
test/              自检（node test/...，不需要 DSH 在跑）
persona.seed.md    种子人格，随便改
docs/design.md     设计文档
locale/            中英文案
```

---

## 自检

```bash
npm test    # 或 node test/lake-core-test.mjs && node test/host-endpoint-test.mjs
```

`lake-core-test` 覆盖半径映射、环带边界、衰减曲线、散列分布；`host-endpoint-test` 会自己造一个 meow-memory 形状的临时库，把四个路由与工具真跑一遍，含坏库、超大请求、非法方法等容错用例。两个脚本都不需要宿主。

---

## 已知状态 / 路线

- [x] 涟漪数据模型与五环衰减
- [x] 设置页：环带亮度、湖面预览、种子人格、心跳与冷却配置（保存会真的落盘）
- [x] 人格注入 + `lakemind_glimpse` 工具
- [x] 顶栏 🌊 入口与全屏湖面（带返回按钮 / Esc 退出）
- [ ] 年轮蒸馏：定时从记忆里提炼"我意识到自己……"
- [ ] 心跳自主体：没人找时自己翻记忆、按闸门决定要不要开口
- [ ] 湖面主面板的完整视觉（现在只有环带与光点）

---

## License

MIT

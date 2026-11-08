# dsh-lakemind — 涟漪记忆湖 / 有性格的自主体

## 0. 一句话

不是把记忆画成星图，而是**一片夜里的湖面**：所有记忆是同一圈一圈扩散的水波，越靠近圆心越重要；随时间按圈层不同速率淡化；人格 = 你写的种子 + 从记忆里长出来的年轮；它是个活物，没人找也会自己醒。

## 1. 涟漪模型（核心数据结构）

### 1.1 半径 = 重要性

每条记忆落在一个半径上：

```
r = clamp( (4 - importance) / 4, 0, 1 )   # importance 4 → r≈0（圆心），importance 1 → r≈1（外缘）
```

importance 会被「涌现」修正：一条记忆被反复检索命中、被用户强调、或关联到当前话题时，`salience += w`，等效于把它向圆心拉近一档。也就是说**重要的事会慢慢往中间沉**。

### 1.2 圈层与分层衰减

湖面分 5 个环带（band 0..4，0 最靠心）。淡化周期到来时，每个环带用自己的半衰期，**外圈退得快、内圈几乎不动**：

| band | 半径 | 名称 | 半衰期 | stale 阈值 | archived 阈值 |
|---|---|---|---|---|---|
| 0 | 0.00–0.15 | 内核 | ∞（不衰减） | — | — |
| 1 | 0.15–0.35 | 骨架 | 180 天 | weight<0.25 | weight<0.08 |
| 2 | 0.35–0.60 | 近期 | 45 天 | weight<0.25 | weight<0.08 |
| 3 | 0.60–0.85 | 表层 | 14 天 | weight<0.25 | weight<0.08 |
| 4 | 0.85–1.00 | 浮沫 | 4 天 | weight<0.25 | weight<0.08 |

亮度权重按艾宾浩斯指数衰减并叠加召回增益：

```
days = (now - max(created_at, last_accessed_at)) / 86400000
weight = exp(-ln2 * days / halfLife[band]) * (1 + 0.35 * recall_count)^0.5
```

- `status=stale` → 视为已完成/已达成，不再进注入，图上画成极暗的空心环。
- `status=archived` → 默认完全不画（可在 UI 里"看沉淀"打开）。

### 1.3 涟漪的视觉语义

- 圆心那颗最亮的点 = **自我**（唯一，不是某条记忆，是所有人格的汇聚处）。
- 每一圈水波 = 一个 band 的边界，波峰亮度由该 band 内活跃记忆的聚合权重决定。
- 单个记忆 = 波上的一个亮点，位置角度由 keywords 哈希稳定分配（同一条永远在同一处），大小随 weight，色相随 level：
  - user/soul 暖金、project 青蓝、rules 紫、fact 灰白、lesson 琥珀、topic 绿松。
- 一次真实召回发生 → 那条涟漪重新亮一下并向圆心收缩半档（动画：波纹轻微回弹）。

## 2. 人格：种子 + 年轮

### 2.1 种子（你规定，占比初始最大）

文件 `$DSH_HOME/lakemind/persona.seed.md`，纯文本，你能直接改。启动时原样作为人格前缀第一段。

### 2.2 年轮（从记忆里长出来）

每次 dream/心跳整理时，从近 N 天的 project/lesson/rules/topic 记忆里蒸馏出若干条「自我描述」，写入 `persona.emerged.jsonl`，每条带 `since` 与 `confidence`。规则：

- 新条目与旧条目高度相似 → 合并并把 confidence +0.1（上限 1.0），代表"这条自我认知被反复验证"。
- confidence 越高、距今越近 → 排序越前。
- 年轮总长度封顶（默认 1200 字），超出时丢最低 confidence 且最旧的。

### 2.3 拼接与注入

最终人格文本 = 种子 + 「我逐渐意识到自己……」段（年轮）。通过官方 `dsh-persona` 行的 `prefix` 挂到某个 Agent Preset 上，作用域只在那套预设里，不污染全局 coding agent。

初始比例大致 7:3（种子:年轮），随运行时间自然变成 4:6 —— 这就是"人格最开始由我规定，另一部分由记忆组成"。

## 3. 自主体：心跳

### 3.1 循环

host 侧定时器（默认 10 分钟一跳，可配）。每跳：

1. 采样自己的记忆湖：最近新增、久未被想起的高权重涟漪、待办（project/todo 子标签）。
2. 用 `ctx.llm` 跑一次内心独白（短，≤60 字），落库为一条 lesson/fact 级"心境"记录。
3. 判定是否值得说话（见 3.2）。
4. 若值得 → 给自己派一句 prompt，走 `agent.followup()` 唤醒它自己的会话；否则只在桌宠气泡冒一句碎碎念。

### 3.2 打扰闸门（保守默认）

主动找你说话必须同时满足：

- 距上次主动发言 > `cooldownMinutes`（默认 90）
- 不在安静时段（默认 23:00–08:00，Asia/Shanghai）
- 触发内容属于：todo 到期、发现记忆互相矛盾、用户明确说过"记得提醒我 X"的事到了时机、或连续 ≥2 天没被理睬后的一次轻唤
- 单会话每小时最多 1 次

一行配置 `speakUp: false` 就彻底闭嘴，性格与记忆照常在。

## 4. 实现约束（这台机器上的事实）

- 宿主：DSH Desktop 0.2.0-rc.2，profile dir `C:\Users\pc\.dsh\profiles\desktop`，插件装不进 CLI（Electron 独占），沿用手工 `package.json deps + dsh.profile.bundles + cordis.patch.yml insert` + 内置 pnpm 的路子。
- 记忆源：**不新建数据库**，直接读 meow-memory 的工作区库 `F:\deepseek\work\.dsh-meow\memory.db`（SQLite 七层表 soul/user/project/fact/lesson/topic/rules + dream_log/windows）。lakemind 只做只读视图 + 自己的旁路文件（persona/emerged/mood/state），避免两套记忆打架。
- Node 内置 `node:sqlite`（Node 24），零外部依赖。
- client 侧只用 loader 提供的 `react` / `react/jsx-runtime` 与宿主已有 `ctx.*`，WebGL2 失败回落 Canvas 2D。样式全用 `--dsw-*` 主题变量，明暗两套都验。
- 注册槽位实测可用：`main`（keyed，整屏面板）、`shell.overlay`（list）、`settings.section`（list）、`conversation.session.header.utilities`（list）。

## 5. 目录

```
dsh-lakemind/
  package.json            # dsh.bundle.patch + dsh.client
  cordis.patch.yml        # insert: id/name = dsh-lakemind
  index.js                # host 半边：Config、记忆湖计算、人格拼接、心跳、工具、HTTP
  client.js               # browser 半边：__ModuleLoader__.load，湖面渲染 + 设置页
  lake-core.js            # 纯函数：band/weight/布局/关键词哈希（可单测）
  persona.seed.md         # 种子人格（用户可改）
  locale/zh.json en.json  # 显示文案
  docs/design.md          # 本文件
```

## 6. 交付节奏

1. M1：能算——涟漪数据模型 + `/lakemind-7350/state` 输出真实记忆湖统计，命令行可见。
2. M2：能看见——`main` 面板画出湖面，点亮度与颜色正确。
3. M3：有性格——persona 行生效，对话里明显带人格；年轮开始积累。
4. M4：活着——心跳跑通，桌宠/浮层冒碎碎念，主动发言受闸门管。

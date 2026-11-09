# dsh-session-namer

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-6f42c1)](https://github.com/LingHXiao/awesome-dsh-plugin)

给 DSH 会话标题自动加分类前缀：读取会话的**第一条用户消息**，判断这次要干什么，把标题改写成固定格式

```
{emoji}{分类} | {标题}
```

例如：

| 首条消息 | 生成的标题 |
| --- | --- |
| 帮我修一下登录接口报 500 | `🔧修复 \| 修登录接口报500` |
| 对比一下 pgvector 和 qdrant | `🔬研究 \| pgvector与qdrant对比` |
| 这个仓库的鉴权在哪实现的 | `🔍探索 \| 仓库鉴权实现位置` |
| 给设置页加个深色模式开关 | `🚧研发 \| 设置页深色模式开关` |

没有这个插件时，会话标题是一串裸文本；有了它，侧边栏一眼就能分出「这是在修 bug」还是「这是在调研」。

## 分类表

| emoji | 分类 | id | 判定信号 |
| --- | --- | --- | --- |
| 🔍 | 探索 | `explore` | 查看代码/结构/位置，找东西，了解现状，不改代码 |
| 🔬 | 研究 | `research` | 选型、方案对比、调研、评估可行性 |
| 🔧 | 修复 | `fix` | 报错、异常、测试失败、崩溃、性能回归 |
| 🚧 | 研发 | `build` | 新增功能、从零实现、重构、加接口 |
| 🎨 | 设计 | `design` | 界面、布局、配色、交互、视觉风格 |
| 📝 | 文档 | `docs` | README、注释、说明、文章、PRD |
| 🧰 | 配置 | `config` | 依赖、环境变量、部署、CI、权限 |
| 💬 | 问答 | `qa` | 概念解释、原理、术语区别，无执行意图 |
| 📦 | 整理 | `tidy` | 批量改名、归档、清理、迁移、去重 |

所有 emoji 都是单码点、无 VS16、固定 4 字节；前缀固定 13 字节；分隔符固定为 ` | `，不随语言、宽度或字节预算降级。

## 安装

从 GitHub 安装（DSH 插件管理器）：

```bash
dsh plugin add github:CresBigB/dsh-session-namer
```

或在 DSH 里用插件管理器指向本地目录：

```
plugin_manager: { action: "install_bundle", target: "<本仓库路径>" }
```

安装后需要**新建一个会话**才会看到效果——标题只在首条消息时生成一次，已有会话不会被追溯改名。

## 工作方式

1. `sessionTitle` 服务只接受一个 provider，因此本插件的 bundle patch 会禁用内置的 `session-title-llm` 行，接管命名。
2. 触发时机是 `first-prompt`：只有主会话的第一条用户消息会触发；fork 与子代理会话（有 `parentSession`）不会，避免污染子代理日志。
3. `generate()` 先用本地关键词规则打一次分，再调用会话当前模型，要求它返回 `{"category":"<id>","title":"<标题>"}`。
4. 模型失败、超时、无可用路由、输出不可解析或分类非法时，降级为「规则分类 + 首句截断」。除 abort 外不抛错，标题永远有值。
5. 标题总预算 256 字节（含 13 字节前缀），超长部分按 UTF-8 码点截断，不加省略号。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `hybrid` | `hybrid` 走「规则 + 模型」，`rules` 只走本地规则（不花 token） |
| `targetCjkCharacters` | `14` | 标题的中文目标字数 |
| `maxTitleBytes` | `256` | 标题总字节预算（含 13 字节前缀） |
| `maxInputBytes` | `8192` | 送给模型的输入上限；插件会先把首条消息裁到 6000 字节左右 |
| `maxOutputTokens` | `512` | 模型输出上限 |
| `timeoutMs` | `5000` | 单次命名调用的超时 |
| `provider` / `model` | 未配置 | 留空则跟随会话当前模型；两者必须同时配置 |

## 兼容性

- 依赖 `@deepseek-ai/dsh-session-title` 与 `@deepseek-ai/dsh-session-title-llm`（由 DSH 本体提供，作为 peerDependencies）。
- 没有路由信息（例如模型尚未选择）时不会调用模型，直接使用规则标题。
- 纯规则模式 `mode: rules` 下不产生任何模型调用。

## 开发与测试

```bash
node --experimental-loader ./test/loader.mjs test/run.mjs
```

测试用 `test/mock/` 下的桩替换 DSH 内部包，覆盖分类、解析、兜底、字节预算、abort 与配置校验，当前 13 个用例全绿。

## License

[MIT](LICENSE)

---

## English

Adds an emoji category prefix to DSH session titles. On the first user message of a session, the plugin classifies the task (explore / research / fix / build / design / docs / config / qa / tidy) and rewrites the title as `{emoji}{category} | {title}`.

Install with `dsh plugin add github:CresBigB/dsh-session-namer`, then start a **new** session — existing sessions keep their titles.

It replaces the built-in first-prompt title provider, falls back to a local keyword classifier whenever the model call fails, and never leaves a session without a title.

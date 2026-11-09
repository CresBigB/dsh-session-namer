# DSH-Session-Namer

## 创建信息

- 创建时间：2026-11-09
- 创建者：deepseek-flash（DSH）
- 目的：为 DSH 会话自动命名——根据会话第一条用户消息判断任务类型，并在标题前加上「emoji + 分类」前缀，格式固定为 `{emoji}{分类} | {标题}`，例如 `🔬研究 | 探索算法`。

## 大体规划

1. 接管 DSH 内置的 `sessionTitle` 标题 provider（禁用内置的 `session-title-llm` 行）。
2. `generate()` 内先做本地规则分类（关键词打分），再调 LLM 输出 `{"category","title"}`；LLM 失败/超时/无路由时用规则分类 + 首句截断兜底。
3. 分类表内置九类：探索 / 研究 / 修复 / 研发 / 设计 / 文档 / 配置 / 问答 / 整理。
4. 标题预算 256 字节；前缀固定 13 字节，任何情况下不替换 `|` 分隔符、不降级模板。

## 分发

- 公开包名 `dsh-session-namer`，仓库 `github.com/CresBigB/dsh-session-namer`。
- 用户安装：`dsh plugin add github:CresBigB/dsh-session-namer`。
- 市场收录：`LingHXiao/awesome-dsh-plugin` 的 `data/plugins/CresBigB__dsh-session-namer.yml`（category: `session`）。
- 改名或改 `cordis.patch.yml` 里的 `name` 字段后，本地必须 `remove_bundle` → `install_bundle` 才会生效。

## 注意事项

- 本目录是会话专属工作目录，不要在此目录之外创建文件。
- 插件通过 `plugin_manager` 的 `install_bundle` 安装到 `desktop` profile，不要手写 profile 的 `package.json` / `cordis.patch.yml`。
- `generate()` 除 abort 外不得抛错：`ensureFallback` 会在 provider 调用前先落一个裸标题，provider 抛错会让会话停在裸标题上。
- 修改 `cordis.patch.yml` 后需要重装（`install_bundle`）才会生效；配置项 `config` 是整体替换，不深合并。
- 首条消息超过 `maxInputBytes` 时执行器会直接抛错，因此本插件在调用前主动把输入裁到 6000 字节。

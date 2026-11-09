import z from "@deepseek-ai/schemastery";
import { SessionTitleProviderId, normalizeSessionTitle } from "@deepseek-ai/dsh-session-title";
import {
  SessionTitleLlmConfigFields,
  executeSessionTitleLlm,
  resolveSessionTitleLlmConfig,
} from "@deepseek-ai/dsh-session-title-llm";

/** Registered title-provider id. */
const name = "session-title-category";

/** Services this plugin depends on. */
const inject = ["sessionTitle", "llm"];

/**
 * Category table.
 *
 * Every emoji below is a single code point without VS16 and renders as exactly
 * four UTF-8 bytes, so the assembled prefix `{emoji}{label} | ` is always
 * 4 + 6 + 3 = 13 bytes. The `|` separator is part of the format contract and is
 * never substituted or degraded.
 */
const CATEGORIES = [
  { id: "explore", emoji: "🔍", label: "探索", hint: "查看现有代码、项目结构、文件位置，找东西，了解现状，不做修改" },
  { id: "research", emoji: "🔬", label: "研究", hint: "技术选型、方案对比、调研资料、评估可行性、读文档或论文" },
  { id: "fix", emoji: "🔧", label: "修复", hint: "已有功能报错、异常、测试失败、崩溃、性能回归" },
  { id: "build", emoji: "🚧", label: "研发", hint: "新增功能、从零实现、重构、加接口、写代码" },
  { id: "design", emoji: "🎨", label: "设计", hint: "界面、布局、配色、交互、视觉风格、组件外观" },
  { id: "docs", emoji: "📝", label: "文档", hint: "README、注释、说明、文章、PRD、教程" },
  { id: "config", emoji: "🧰", label: "配置", hint: "安装依赖、环境变量、部署、CI、权限、工具链设置" },
  { id: "qa", emoji: "💬", label: "问答", hint: "概念解释、原理询问、术语区别，没有执行意图" },
  { id: "tidy", emoji: "📦", label: "整理", hint: "批量改名、归档、清理、迁移文件结构、去重" },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

/** Used when nothing matches; most first messages do ask for work. */
const DEFAULT_CATEGORY_ID = "build";

/**
 * Rule keywords, evaluated in order. Higher `weight` makes a category win more
 * often; a strict `>` comparison keeps earlier entries ahead on ties, so `fix`
 * outranks everything when a message reports an error.
 */
const RULES = [
  {
    id: "fix",
    weight: 3,
    words: [
      "报错", "错误", "异常", "崩溃", "失败", "跑不起来", "不工作", "无法运行", "无法启动",
      "修复", "修一下", "修好", "bug", "error", "exception", "traceback", "stack trace",
      "crash", "failing", "failed", "broken", "regression", "regressed",
    ],
  },
  {
    id: "tidy",
    weight: 2.5,
    words: [
      "整理", "归档", "清理", "重命名", "改名", "迁移", "删除文件", "去重",
      "cleanup", "clean up", "organize", "rename", "archive", "dedupe", "migrate",
    ],
  },
  {
    id: "config",
    weight: 2.5,
    words: [
      "安装", "配置", "部署", "环境变量", "依赖", "权限", "install", "setup",
      "deploy", "docker", "ci ", "env ", "permission", "toolchain",
    ],
  },
  {
    id: "build",
    weight: 2,
    words: [
      "实现", "新增", "添加", "开发", "写一个", "做一个", "重构", "加一个", "接入",
      "implement", "create ", "build ", "refactor", "add ",
    ],
  },
  {
    id: "docs",
    weight: 2.5,
    words: ["文档", "注释", "写文章", "教程", "prd", "readme", "documentation", "comment", "docs", "changelog"],
  },
  {
    id: "design",
    weight: 2,
    words: ["界面", "布局", "配色", "样式", "交互", "视觉", "主题", "ui", "ux", "css", "design", "layout", "theme", "typography"],
  },
  {
    id: "research",
    weight: 2,
    words: ["选型", "对比", "调研", "研究", "评估", "技术方案", "benchmark", "compare", "tradeoff", "evaluate", "survey"],
  },
  {
    id: "explore",
    weight: 1.5,
    words: ["看看", "查看", "分析一下", "结构", "在哪", "怎么实现", "定位", "找到", "explore", "look at", "where is", "walk through", "inspect"],
  },
  {
    id: "qa",
    weight: 1.5,
    words: ["什么是", "为什么", "原理", "区别", "解释", "what is", "why ", "how does", "explain", "difference"],
  },
];

/** Loader schema: execution controls are shared with the built-in LLM provider. */
const Config = z.object({
  mode: z.string(),
  targetCjkCharacters: z.number().step(1).min(1).required(),
  maxTitleBytes: z.number().step(1).min(1).required(),
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
});

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title-category: ${field} must be a positive integer`);
  }
  return value;
}

/** Validate the plugin config into one immutable policy object. */
function resolveConfig(config) {
  const { mode, targetCjkCharacters, maxTitleBytes, ...execution } = config;
  return {
    ...resolveSessionTitleLlmConfig(execution),
    mode: mode === "rules" ? "rules" : "hybrid",
    targetCjkCharacters: assertPositiveInteger("targetCjkCharacters", targetCjkCharacters),
    maxTitleBytes: assertPositiveInteger("maxTitleBytes", maxTitleBytes),
  };
}

/** Pick the least supported reasoning effort for an auxiliary title call. */
const selectReasoningEffort = (model) => model.reasoning?.efforts[0]?.id;

/** Local keyword classifier; always returns a known category id. */
function classifyByRules(text) {
  const haystack = text.toLowerCase();
  let bestId = DEFAULT_CATEGORY_ID;
  let bestScore = 0;
  for (const rule of RULES) {
    let hits = 0;
    for (const word of rule.words) {
      if (haystack.includes(word)) hits += 1;
    }
    if (hits === 0) continue;
    const score = hits * rule.weight;
    if (score > bestScore) {
      bestScore = score;
      bestId = rule.id;
    }
  }
  if (bestScore > 0) return bestId;
  return /[?？]/u.test(text) && text.length < 40 ? "qa" : DEFAULT_CATEGORY_ID;
}

/** Language-aware instruction asking for one JSON object. */
function systemPrompt(config) {
  return [
    "你是 AI 编程会话的命名器。根据给出的用户第一条消息，判断这次会话属于哪一类，并起一个简洁的标题。",
    "分类只能从下面的列表里选一个，输出它的 id：",
    ...CATEGORIES.map((category) => `- ${category.id} ${category.emoji}${category.label}：${category.hint}`),
    "判断规则：",
    "- 用户只是问概念、原理、区别，没有让你动手 → qa。",
    "- 用户让你去看、去找、去了解现状 → explore。",
    "- 用户要做技术选型、方案对比、调研 → research。",
    "- 用户报告报错、失败、异常，或要求修好 → fix。",
    "- 用户要新增或改动功能代码 → build。",
    "- 只涉及界面、布局、视觉 → design；只涉及文档 → docs；只涉及依赖、环境、部署 → config；只涉及改名、归档、清理 → tidy。",
    `标题使用消息的语言，中文约 ${config.targetCjkCharacters} 个字或英文约 8 个词，具体、可区分，不含引号、emoji、冒号或竖线。`,
    '只输出一行 JSON，不要 Markdown、不要代码块、不要解释：{"category":"<id>","title":"<标题>"}',
  ].join("\n");
}

/** Clip text to a UTF-8 byte budget without splitting a code point. */
function clipUtf8(text, maxBytes) {
  let bytes = 0;
  let out = "";
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return out;
}

/**
 * Frame the first message as JSON so user text cannot break the structure, and
 * pre-clip it: the shared executor rejects over-budget input instead of
 * truncating it.
 */
function frameInput(first, maxInputBytes) {
  const budget = Math.max(256, maxInputBytes - 512);
  const text = clipUtf8(typeof first.text === "string" ? first.text : "", budget).trim();
  if (text.length === 0) return undefined;
  return `判断下面这条人类消息的会话分类并起标题：\n${JSON.stringify([{ seq: first.seq, text }])}`;
}

/** Concatenate the text blocks of one response, ignoring malformed finishes. */
function textFromResponse(response) {
  return response.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Parse the model output into an optional category id and a non-empty title.
 * Accepts the requested JSON object, a `分类 | 标题` line, or a bare title.
 */
function parseModelOutput(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  const json = trimmed.match(/\{[\s\S]*\}/u);
  if (json !== null) {
    try {
      const value = JSON.parse(json[0]);
      const categoryId = typeof value?.category === "string" ? value.category.trim().toLowerCase() : "";
      const title = typeof value?.title === "string" ? value.title.trim() : "";
      if (title.length > 0) {
        return CATEGORY_BY_ID.has(categoryId) ? { categoryId, title } : { title };
      }
    } catch {
      // Not JSON; fall through to the line-based forms.
    }
  }

  const line = trimmed.split(/\r?\n/u).map((item) => item.trim()).find((item) => item.length > 0) ?? "";
  if (line.length === 0) return undefined;

  const parts = line.split("|");
  if (parts.length >= 2) {
    const left = parts[0].trim();
    const title = parts.slice(1).join("|").trim();
    const matched = CATEGORIES.find(
      (category) => left.includes(category.label) || left.includes(category.emoji) || left === category.id,
    );
    if (matched !== undefined && title.length > 0) return { categoryId: matched.id, title };
  }

  const stripped = line.replace(/^[\p{Extended_Pictographic}\s]+/u, "").trim();
  return stripped.length > 0 ? { title: stripped } : undefined;
}

/** Strip code fences, URLs, list markers, pleasantries, and trailing punctuation. */
const PLEASANTRY = /^(?:你好|您好|hi|hello|hey|请|帮我|帮忙|麻烦|我想|我打算|我需要|我要|能不能|能否|可以|可不可以|你这边|你帮我|想做一个|做一个|来个|看一下|看下|看看|瞧瞧)/iu;

function deriveTitle(text, targetCjkCharacters) {
  let value = text;
  value = value.replace(/```[\s\S]*?```/gu, " ");
  value = value.replace(/`([^`]*)`/gu, "$1");
  value = value.replace(/https?:\/\/\S+/gu, " ");
  value = value
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[\s>*#\-+]+/u, "").trim())
    .find((line) => line.length > 0) ?? value;
  value = value.replace(/\s+/gu, " ").trim();

  const sentence = value.split(/[。！？!?；;]/u)[0]?.trim() ?? "";
  if (sentence.length > 0) value = sentence;

  for (let index = 0; index < 4; index += 1) {
    const next = value.replace(PLEASANTRY, "").trim();
    if (next === value) break;
    value = next;
  }

  value = value.replace(/^[，,、:：\s]+/u, "").replace(/[。.!！?？;；:：,，\s]+$/u, "");
  if (value.length === 0) return "";

  if (/[\u3400-\u9fff]/u.test(value)) {
    return Array.from(value).slice(0, Math.max(4, targetCjkCharacters)).join("");
  }
  return value.split(/\s+/u).filter(Boolean).slice(0, 8).join(" ");
}

/** Assemble `{emoji}{label} | {title}` inside the configured byte budget. */
function composeTitle(category, body, maxTitleBytes) {
  const prefix = `${category.emoji}${category.label} | `;
  const budget = Math.max(1, maxTitleBytes - Buffer.byteLength(prefix, "utf8"));
  const title = normalizeSessionTitle(body, budget).trimEnd();
  return `${prefix}${title.length > 0 ? title : "新会话"}`;
}

/**
 * Register the first-prompt category provider.
 *
 * `generate` must never throw except on abort: the service writes a bare
 * fallback title before calling a provider and keeps it when the provider
 * fails. Every model or route problem therefore degrades to the rule-based
 * title instead of escaping.
 */
function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const titleProvider = SessionTitleProviderId(name);

  ctx.sessionTitle.register({
    id: titleProvider,
    automatic: "first-prompt",
    async generate(request) {
      const first = request.messages[0];
      if (first === void 0) {
        throw new Error("session-title-category: first-prompt requires one human message");
      }

      const raw = typeof first.text === "string" ? first.text : "";
      let category = CATEGORY_BY_ID.get(classifyByRules(raw)) ?? CATEGORY_BY_ID.get(DEFAULT_CATEGORY_ID);
      let body = "";
      let model;

      if (resolved.mode !== "rules") {
        try {
          const input = frameInput(first, resolved.maxInputBytes);
          if (input !== undefined) {
            const response = await executeSessionTitleLlm(ctx, resolved, request, titleProvider, {
              system: systemPrompt(resolved),
              input,
              messageSeqs: [first.seq],
              selectReasoningEffort,
            });
            const parsed = parseModelOutput(textFromResponse(response));
            if (parsed !== undefined) {
              category = (parsed.categoryId !== undefined ? CATEGORY_BY_ID.get(parsed.categoryId) : undefined) ?? category;
              body = parsed.title;
              model = response.model;
            }
          }
        } catch (error) {
          if (request.signal.aborted) throw error;
          // Degrade to the rule-based title below.
        }
      }

      if (body.length === 0) body = deriveTitle(raw, resolved.targetCjkCharacters);
      const title = composeTitle(category, body, resolved.maxTitleBytes);
      return { title, messageSeqs: [first.seq], ...(model === undefined ? {} : { model }) };
    },
  });
}

export { Config, apply, inject, name };

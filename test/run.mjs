import assert from "node:assert/strict";
import { apply, Config, inject, name } from "../index.js";
import { setExecuteBehavior } from "./mock/session-title-llm.mjs";

const BASE_CONFIG = Object.freeze({
  mode: "hybrid",
  targetCjkCharacters: 14,
  maxTitleBytes: 256,
  maxInputBytes: 8192,
  maxOutputTokens: 512,
  timeoutMs: 5000,
});

let registration;
function provider(config = BASE_CONFIG) {
  const ctx = {
    llm: { prepareCall() {} },
    sessionTitle: {
      register(candidate) {
        registration = candidate;
      },
    },
  };
  apply(ctx, config);
  assert.ok(registration, "provider must register");
  return registration;
}

function request(text, seq = 3) {
  return {
    session: { id: "session-1", append() {} },
    messages: [{ seq, text }],
    signal: new AbortController().signal,
  };
}

function llmJson(payload) {
  return async () => ({
    blocks: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }],
    finish: { kind: "stop" },
    model: { provider: "test", model: "test-model" },
  });
}

const cases = [];
function test(label, run) {
  cases.push({ label, run });
}

test("llm json chooses category and title", async () => {
  provider();
  setExecuteBehavior(llmJson({ category: "research", title: "向量检索选型" }));
  const result = await registration.generate(request("我想研究一下向量数据库怎么选"));
  assert.equal(result.title, "🔬研究 | 向量检索选型");
  assert.deepEqual(result.messageSeqs, [3]);
  assert.deepEqual(result.model, { provider: "test", model: "test-model" });
});

test("llm failure falls back to rule classification", async () => {
  provider();
  setExecuteBehavior(async () => {
    throw new Error("boom");
  });
  const result = await registration.generate(request("帮我修复这个报错：TypeError: x is not a function"));
  assert.ok(result.title.startsWith("🔧修复 | "), result.title);
  assert.ok(result.model === undefined);
});

test("rules mode never calls the model", async () => {
  provider({ ...BASE_CONFIG, mode: "rules" });
  setExecuteBehavior(async () => {
    throw new Error("must not be called");
  });
  const result = await registration.generate(request("看看这个项目的结构，文件都在哪"));
  assert.ok(result.title.startsWith("🔍探索 | "), result.title);
});

test("bare title from model keeps rule category", async () => {
  provider();
  setExecuteBehavior(llmJson("清理临时文件"));
  const result = await registration.generate(request("把临时文件都清理一下"));
  assert.equal(result.title, "📦整理 | 清理临时文件");
});

test("pipe separated model output is accepted", async () => {
  provider();
  setExecuteBehavior(llmJson("修复 | 空指针崩溃"));
  const result = await registration.generate(request("程序崩溃了，空指针"));
  assert.equal(result.title, "🔧修复 | 空指针崩溃");
});

test("unknown category id keeps rule category and model title", async () => {
  provider();
  setExecuteBehavior(llmJson({ category: "nonsense", title: "模型给的标题" }));
  const result = await registration.generate(request("写一个登录接口"));
  assert.equal(result.title, "🚧研发 | 模型给的标题");
});

test("question without action becomes qa", async () => {
  provider({ ...BASE_CONFIG, mode: "rules" });
  const result = await registration.generate(request("什么是闭包？"));
  assert.ok(result.title.startsWith("💬问答 | "), result.title);
});

test("huge first message is clipped instead of failing", async () => {
  provider();
  let seenInputLength = 0;
  setExecuteBehavior(async (_ctx, _config, _request, _id, prepared) => {
    seenInputLength = Buffer.byteLength(prepared.input, "utf8");
    return {
      blocks: [{ type: "text", text: '{"category":"build","title":"批量重写"}' }],
      finish: { kind: "stop" },
      model: { provider: "test", model: "test-model" },
    };
  });
  const result = await registration.generate(request("重写 ".repeat(6000)));
  assert.ok(seenInputLength <= BASE_CONFIG.maxInputBytes, `input bytes ${seenInputLength}`);
  assert.equal(result.title, "🚧研发 | 批量重写");
});

test("over budget model title is truncated to maxTitleBytes", async () => {
  provider();
  setExecuteBehavior(llmJson({ category: "docs", title: "很".repeat(400) }));
  const result = await registration.generate(request("写一份文档"));
  assert.ok(Buffer.byteLength(result.title, "utf8") <= BASE_CONFIG.maxTitleBytes, String(Buffer.byteLength(result.title, "utf8")));
  assert.ok(result.title.startsWith("📝文档 | "), result.title);
});

test("empty text still yields a non-empty title", async () => {
  provider({ ...BASE_CONFIG, mode: "rules" });
  const result = await registration.generate(request(""));
  assert.ok(result.title.length > 0);
  assert.ok(result.title.includes("|"));
});

test("abort is rethrown", async () => {
  provider();
  const controller = new AbortController();
  controller.abort();
  setExecuteBehavior(async () => {
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(
    registration.generate({ ...request("随便"), signal: controller.signal }),
    /aborted|AbortError/u,
  );
});

test("config guards reject bad values", async () => {
  assert.throws(() => provider({ ...BASE_CONFIG, maxTitleBytes: 0 }), /maxTitleBytes/u);
  assert.throws(() => provider({ ...BASE_CONFIG, targetCjkCharacters: 1.5 }), /targetCjkCharacters/u);
});

test("exports are shaped for the loader", async () => {
  assert.equal(name, "session-title-category");
  assert.deepEqual(inject, ["sessionTitle", "llm"]);
  assert.ok(Config);
  assert.equal(typeof apply, "function");
});

let failed = 0;
for (const item of cases) {
  try {
    await item.run();
    console.log(`ok   ${item.label}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.label}\n     ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exitCode = 1;

// Loader that maps DSH-internal specifiers to local stubs so index.js can be
// exercised in plain Node outside the harness.
const MOCKS = new Map([
  ["@deepseek-ai/schemastery", "./mock/schemastery.mjs"],
  ["@deepseek-ai/dsh-session-title", "./mock/session-title.mjs"],
  ["@deepseek-ai/dsh-session-title-llm", "./mock/session-title-llm.mjs"],
]);

export async function resolve(specifier, context, nextResolve) {
  const mock = MOCKS.get(specifier);
  if (mock !== undefined) {
    return { url: new URL(mock, import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

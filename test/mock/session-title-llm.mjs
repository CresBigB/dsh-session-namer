// Stub of the shared LLM title executor; the test controls its behaviour.

export const SessionTitleLlmConfigFields = {
  maxInputBytes: {},
  maxOutputTokens: {},
  timeoutMs: {},
  provider: {},
  model: {},
};

const KEYS = new Set(["maxInputBytes", "maxOutputTokens", "timeoutMs", "provider", "model"]);

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`session-title-llm: ${name} must be a positive integer`);
}

export function resolveSessionTitleLlmConfig(config) {
  if (config === null || typeof config !== "object") throw new Error("session-title-llm: configuration is required");
  for (const key of Object.keys(config)) {
    if (!KEYS.has(key)) throw new Error(`session-title-llm: unknown config key "${key}"`);
  }
  assertPositiveInteger("maxInputBytes", config.maxInputBytes);
  assertPositiveInteger("maxOutputTokens", config.maxOutputTokens);
  assertPositiveInteger("timeoutMs", config.timeoutMs);
  const hasProvider = config.provider !== undefined;
  if (hasProvider !== (config.model !== undefined)) {
    throw new Error("session-title-llm: provider and model must be supplied together");
  }
  return Object.freeze({ ...config });
}

let behavior = () => {
  throw new Error("executeSessionTitleLlm: no stub installed");
};

export function setExecuteBehavior(next) {
  behavior = next;
}

export const executeSessionTitleLlm = async (...args) => behavior(...args);

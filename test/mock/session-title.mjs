// Faithful-enough reimplementation of the two helpers index.js imports.

export const SessionTitleProviderId = (id) => id;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;

function cleanTitleText(input) {
  return String(input)
    .replace(/\u001b\][^\u0007]*\u0007/gu, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "")
    .replace(/\u001b[@-_]/gu, "")
    .replace(CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateTitleUtf8(input, maxBytes) {
  let bytes = 0;
  let out = "";
  for (const character of input) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return out;
}

export function normalizeSessionTitle(input, maxBytes) {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd();
}

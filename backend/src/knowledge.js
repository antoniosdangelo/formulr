// Optional reference material for the model. Files in knowledge/ are bundled by scripts/build-knowledge.mjs.
// A pack with a `triggers:` line is added only to questions that match it, so unrelated questions stay fast and cheap.
import { PACKS } from "./knowledge.data.js";

export function selectPacks(packs, text) {
  const haystack = String(text ?? "");
  return packs.filter((p) => !p.triggers || new RegExp(p.triggers, "i").test(haystack));
}

export function knowledgeFor(packs, ...parts) {
  const hits = selectPacks(packs, parts.filter(Boolean).join(" "));
  return hits.map((p) => p.text).join("\n\n").trim();
}

export { PACKS };

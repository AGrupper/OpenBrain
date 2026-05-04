import { ensureParaFolderPath } from "../../../../packages/shared/src/para";

export const DETERMINISTIC_PROVIDER = "deterministic";

const STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "markdown",
  "note",
  "notes",
  "openbrain",
  "smoke",
  "test",
]);

export function isDeterministicProvider(provider: string): boolean {
  return provider === DETERMINISTIC_PROVIDER || provider === "smoke";
}

export function pathTokens(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

export function deterministicOrganization(filePath: string): { folder: string; tags: string[] } {
  const tokens = pathTokens(filePath);

  if (tokens.has("unrelated")) {
    return {
      folder: ensureParaFolderPath("smoke/unrelated"),
      tags: ["architect-smoke", "unrelated"],
    };
  }

  if (tokens.has("related")) {
    return {
      folder: ensureParaFolderPath("smoke/related"),
      tags: ["architect-smoke", "related"],
    };
  }

  if (tokens.has("organization") || tokens.has("organize")) {
    return {
      folder: ensureParaFolderPath("smoke/organized"),
      tags: ["architect-smoke", "organization"],
    };
  }

  return { folder: ensureParaFolderPath("smoke/inbox"), tags: ["architect-smoke"] };
}

export function deterministicRelatedness(
  titleA: string,
  titleB: string,
): { related: boolean; reason: string; confidence: number } {
  const tokensA = pathTokens(titleA);
  const tokensB = pathTokens(titleB);

  if (tokensA.has("unrelated") || tokensB.has("unrelated")) {
    return {
      related: false,
      reason: "The deterministic smoke check keeps unrelated test notes separate.",
      confidence: 0.15,
    };
  }

  if (tokensA.has("related") && tokensB.has("related")) {
    return {
      related: true,
      reason: "Both disposable smoke notes are marked as part of the related test pair.",
      confidence: 0.82,
    };
  }

  const sharedTokens = [...tokensA].filter(
    (token) => token.length > 3 && !STOP_WORDS.has(token) && tokensB.has(token),
  );

  if (sharedTokens.length > 0) {
    return {
      related: true,
      reason: `Both disposable smoke notes share the "${sharedTokens[0]}" topic.`,
      confidence: 0.72,
    };
  }

  return {
    related: false,
    reason: "The deterministic smoke check found no shared test topic.",
    confidence: 0.2,
  };
}

export function deterministicEmbedding(text: string, dimensions: number): number[] {
  const tokens = pathTokens(text);
  const vector = new Array<number>(dimensions).fill(0);

  if (tokens.has("related")) {
    vector[0] = 1;
    return vector;
  }

  if (tokens.has("unrelated")) {
    vector[1] = 1;
    return vector;
  }

  if (tokens.has("organization") || tokens.has("organize")) {
    vector[2] = 1;
    return vector;
  }

  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  vector[hash % dimensions] = 1;
  return vector;
}

/**
 * Deterministic local smoke runner.
 * Run: npm run smoke:run
 */
process.env.EMBEDDING_PROVIDER = "deterministic";
process.env.ARCHITECT_MODEL_PROVIDER = "deterministic";

const [{ main: runLinker }, { main: runTagger }] = await Promise.all([
  import("./linker"),
  import("./tagger"),
]);

await runLinker();
await runTagger();

export {};

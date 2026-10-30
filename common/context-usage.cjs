"use strict";
// Serialized into the native renderer. Reads only numeric metadata, never drafts.
function createContextReader() {
  function count(value) {
    if (typeof value === "bigint")
      return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : null;
    if (typeof value === "string" && /^\d{1,16}$/.test(value))
      value = Number(value);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function providerFor(trigger) {
    const key = Object.keys(trigger || {}).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    let fiber = key && trigger[key];
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      let dependency = fiber.dependencies?.firstContext;
      for (
        let index = 0;
        dependency && index < 16;
        index++, dependency = dependency.next
      ) {
        const provider =
          dependency.memoizedValue?.cascadeContext?.state?.agentStateProvider;
        if (
          typeof provider?.getState === "function" &&
          typeof provider?.onDidChange === "function"
        )
          return provider;
      }
    }
    return null;
  }
  function snapshot(state) {
    const slice = state?.trajectorySlice;
    if (!slice) return null;
    const generations = slice.generatorMetadatasInSlice;
    const generation = Array.isArray(generations) ? generations.at(-1) : null;
    const context = generation?.metadata?.value?.contextWindowMetadata;
    const used = count(context?.estimatedTokensUsed),
      max = count(context?.maxContextTokens);
    const steps = slice.stepsInSlice;
    let usage;
    if (Array.isArray(steps))
      for (let index = steps.length - 1; index >= 0; index--) {
        if (steps[index]?.metadata?.modelUsage) {
          usage = steps[index].metadata.modelUsage;
          break;
        }
      }
    const input = count(usage?.inputTokens),
      cacheRead = count(usage?.cacheReadTokens),
      cacheWrite = count(usage?.cacheWriteTokens);
    if (used === null && !(input > 0 || cacheRead > 0 || cacheWrite > 0))
      return null;
    return {
      used,
      max: max > 0 ? max : null,
      percent: used !== null && max > 0 ? (used / max) * 100 : null,
      input,
      cacheRead,
      cacheWrite,
    };
  }
  return { providerFor, snapshot };
}
module.exports = { createContextReader };

/**
 * reportPrompt.ts — C1-LITE neutral report writer (GEMINI)
 * ------------------------------------------------------------------
 * Runs on gemini-2.5-flash, mirroring your existing ai.service.ts:
 * fetch → responseMimeType "application/json" → responseSchema.
 *
 * NEUTRALITY: unlike the current generateReportAiContent(), this NEVER
 * recommends, ranks, or selects a school (master prompt R6 / gate G8).
 * There is no "recommendation" field. Families decide.
 *
 * NUMBERS: the model may only place numbers that appear in the payload
 * (R1). It never computes, subtracts, estimates, or rounds.
 *
 * This file is only an index. The implementation lives in ./prompt/:
 *   types.ts             payload + narrative shapes
 *   promptText.ts        the model instructions (buildPromptText)
 *   geminiSchema.ts      JSON response schema
 *   fallbackNarrative.ts payload-only narrative (no API key / model failure)
 *   generator.ts         generateC1LiteNarrative (Gemini call)
 *   gates.ts             acceptance gates (runGates, findBannedPhrases, ...)
 */

export * from "./prompt/types";
export * from "./prompt/promptText";
export * from "./prompt/geminiSchema";
export * from "./prompt/fallbackNarrative";
export * from "./prompt/generator";
export * from "./prompt/gates";

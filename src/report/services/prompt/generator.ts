/** Calls Gemini for the narrative; falls back to the deterministic one on any failure. */
import { buildPromptText } from "./promptText";
import { GEMINI_RESPONSE_SCHEMA } from "./geminiSchema";
import { buildFallbackNarrative } from "./fallbackNarrative";
import type { C1LitePayload, C1LiteNarrative } from "./types";

// ---------------- GENERATOR (Gemini) ----------------
export async function generateC1LiteNarrative(payload: C1LitePayload): Promise<C1LiteNarrative> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ GEMINI_API_KEY environment variable is not defined. Falling back to structured, payload-only C1-Lite narrative.");
    return buildFallbackNarrative(payload);
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPromptText(payload) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          temperature: 0.4,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return JSON.parse(text) as C1LiteNarrative;
  } catch (error) {
    console.error("Error generating C1-Lite narrative via Gemini API:", error);
    return buildFallbackNarrative(payload);
  }
}

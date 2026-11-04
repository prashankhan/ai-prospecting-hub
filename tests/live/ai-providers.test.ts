/**
 * Opt-in live checks against real provider APIs. Skipped unless the corresponding key is set:
 *   GEMINI_API_KEY=... GEMINI_MODEL=... npm test -- tests/live
 * These make real (billable) requests: one model listing and one small generation per provider.
 */
import { describe, expect, it } from "vitest";
import { extractJSONObject } from "@/lib/ai/http";
import { buildQualificationPrompt } from "@/lib/ai/prompts";
import { getAIAdapter } from "@/lib/ai/providers";
import { qualificationOutputSchema } from "@/lib/ai/schemas";
import type { AIProviderId } from "@/lib/ai/types";

const PROVIDERS: { id: AIProviderId; key?: string; model?: string }[] = [
  { id: "gemini", key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
  { id: "anthropic", key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL },
  { id: "openai", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
  { id: "openrouter", key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL },
];

for (const p of PROVIDERS) {
  describe.skipIf(!p.key)(`live: ${p.id}`, () => {
    it("lists models with a valid key", async () => {
      const res = await getAIAdapter(p.id).testConnection(p.key!);
      expect(res.ok).toBe(true);
      expect(res.models.length).toBeGreaterThan(0);
    }, 30_000);

    it.skipIf(!p.model)("returns schema-valid qualification JSON", async () => {
      const { system, prompt } = buildQualificationPrompt(
        {
          name: "Test", product_name: "Studio software", product_description: "Booking software for tattoo studios",
          target_industry: "Tattoo studios", target_countries: ["United States"], ideal_customer_profile: "Independent studios",
          qualification_criteria: "Takes bookings", exclusion_criteria: "Removal-only clinics", messaging_tone: "", ai_instructions: "",
          outreach_objective: "", preferred_channel: "instagram",
        },
        [{ ref: "S1", kind: "source_record", label: "Test record", content: "Business name: Example Ink\nCategory: Tattoo shop\nCity: Austin" }],
        60,
      );
      const res = await getAIAdapter(p.id).generateJSON({ apiKey: p.key!, model: p.model!, system, prompt });
      const parsed = qualificationOutputSchema.safeParse(extractJSONObject(res.text));
      expect(parsed.success).toBe(true);
    }, 90_000);
  });
}

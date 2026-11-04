import { z } from "zod";

export const OUTREACH_CHANNELS = ["instagram", "email", "phone", "website_form", "other"] as const;
export const CHANNEL_LABELS: Record<(typeof OUTREACH_CHANNELS)[number], string> = {
  instagram: "Instagram (manual DM)",
  email: "Email (manual)",
  phone: "Phone",
  website_form: "Website contact form",
  other: "Other",
};
export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;

const text = (max: number) => z.string().trim().max(max).default("");
const list = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .transform((v) => [...new Set(v)]);

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  product_name: text(120),
  product_description: text(2000),
  website: z.string().trim().max(300).url("Enter a full URL, e.g. https://example.com").or(z.literal("")).default(""),
  target_industry: text(200),
  target_countries: list,
  target_cities: list,
  ideal_customer_profile: text(3000),
  qualification_criteria: text(3000),
  exclusion_criteria: text(3000),
  preferred_channel: z.enum(OUTREACH_CHANNELS),
  messaging_tone: text(500),
  ai_instructions: text(3000),
  outreach_objective: text(500),
  qualification_threshold: z.coerce.number().int().min(0).max(100),
  status: z.enum(PROJECT_STATUSES),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

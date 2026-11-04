export const IMPORT_FIELDS = ["business_name", "category", "country", "city", "address", "website", "phone", "email", "instagram"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  business_name: "Business name",
  category: "Category",
  country: "Country",
  city: "City",
  address: "Address",
  website: "Website",
  phone: "Public phone",
  email: "Public business email",
  instagram: "Instagram username or URL",
};

const ALIASES: Record<ImportField, string[]> = {
  business_name: ["business name", "business", "name", "company", "studio", "studio name", "title"],
  category: ["category", "type", "industry"],
  country: ["country", "country code"],
  city: ["city", "town", "locality"],
  address: ["address", "street", "full address", "location"],
  website: ["website", "url", "site", "web", "domain"],
  phone: ["phone", "telephone", "phone number", "tel"],
  email: ["email", "e-mail", "email address"],
  instagram: ["instagram", "instagram username", "instagram url", "ig", "insta", "handle"],
};

/** Suggests a column for each field from header names. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && ALIASES[field].includes(h.trim().toLowerCase().replace(/[_-]+/g, " ")));
    if (hit) {
      out[field] = hit;
      used.add(hit);
    }
  }
  return out;
}

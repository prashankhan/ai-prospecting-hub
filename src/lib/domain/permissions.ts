export type AppRole = "admin" | "operator";

/**
 * Capability matrix. Server actions call `assertCan`; RLS independently enforces project
 * isolation and admin-only writes in the database, so a UI bypass is never sufficient.
 */
export const CAPABILITIES = {
  "projects.manage": ["admin"],
  "team.manage": ["admin"],
  "integrations.manage": ["admin"],
  "settings.manage": ["admin"],
  "prospects.assign": ["admin"],
  "prospects.delete": ["admin"],
  "prospects.import": ["admin"],
  "prospects.export": ["admin", "operator"],
  "prospects.edit": ["admin", "operator"],
  "prospects.note": ["admin", "operator"],
  "discovery.run": ["admin"],
  "qualification.bulk": ["admin"],
  "qualification.single": ["admin", "operator"],
  "drafts.generate": ["admin", "operator"],
  "drafts.approve": ["admin", "operator"],
  "outreach.perform": ["admin", "operator"],
  "outreach.status": ["admin", "operator"],
  "dnc.set": ["admin", "operator"],
  "dnc.lift": ["admin"],
  "matches.resolve": ["admin", "operator"],
  "audit.view": ["admin"],
  "usage.view": ["admin"],
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[capability] as readonly AppRole[]).includes(role);
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: AppRole | null | undefined, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError();
}

/** Admins can access every project; operators only projects they are members of. */
export function canAccessProject(
  user: { role: AppRole; status: "active" | "disabled" },
  projectId: string,
  memberProjectIds: readonly string[],
): boolean {
  if (user.status !== "active") return false;
  if (user.role === "admin") return true;
  return memberProjectIds.includes(projectId);
}

import { describe, expect, it } from "vitest";
import { assertCan, can, canAccessProject, ForbiddenError } from "@/lib/domain/permissions";

describe("permissions", () => {
  it("restricts administration and paid jobs to admins", () => {
    for (const cap of ["projects.manage", "team.manage", "integrations.manage", "discovery.run", "qualification.bulk", "dnc.lift"] as const) {
      expect(can("admin", cap)).toBe(true);
      expect(can("operator", cap)).toBe(false);
    }
  });
  it("lets operators do outreach work", () => {
    for (const cap of ["drafts.generate", "drafts.approve", "outreach.perform", "outreach.status", "qualification.single"] as const) {
      expect(can("operator", cap)).toBe(true);
    }
  });
  it("denies unauthenticated users", () => {
    expect(can(null, "outreach.perform")).toBe(false);
    expect(() => assertCan(undefined, "prospects.edit")).toThrow(ForbiddenError);
  });
  it("enforces project membership for operators", () => {
    expect(canAccessProject({ role: "operator", status: "active" }, "p1", ["p1"])).toBe(true);
    expect(canAccessProject({ role: "operator", status: "active" }, "p2", ["p1"])).toBe(false);
    expect(canAccessProject({ role: "admin", status: "active" }, "p2", [])).toBe(true);
    expect(canAccessProject({ role: "admin", status: "disabled" }, "p2", [])).toBe(false);
  });
});

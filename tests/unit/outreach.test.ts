import { describe, expect, it } from "vitest";
import { selectableStatuses, validateTransition } from "@/lib/domain/outreach";

const op = { isAdmin: false, hasApprovedDraft: true };

describe("outreach status transitions", () => {
  it("only reaches contacted through explicit confirmation from an approved draft", () => {
    expect(validateTransition("approved", "contacted", op)).toEqual({ ok: false, error: "use_mark_contacted" });
    expect(validateTransition("approved", "contacted", op, "mark_contacted")).toEqual({ ok: true });
    expect(validateTransition("draft", "contacted", op, "mark_contacted")).toEqual({ ok: false, error: "requires_approved_draft" });
    expect(validateTransition("approved", "contacted", { ...op, hasApprovedDraft: false }, "mark_contacted").ok).toBe(false);
  });
  it("never returns a contacted prospect to the pre-contact queue", () => {
    for (const to of ["new", "draft", "ready_for_review", "approved"] as const) {
      expect(validateTransition("contacted", to, op)).toEqual({ ok: false, error: "cannot_return_to_pre_contact" });
      expect(validateTransition("interested", to, op).ok).toBe(false);
    }
  });
  it("records responses only after contact", () => {
    expect(validateTransition("approved", "interested", op)).toEqual({ ok: false, error: "not_contacted_yet" });
    expect(validateTransition("contacted", "responded", op)).toEqual({ ok: true });
    expect(validateTransition("responded", "interested", op)).toEqual({ ok: true });
    expect(validateTransition("interested", "trial_registered", op)).toEqual({ ok: true });
    expect(validateTransition("trial_registered", "converted", op)).toEqual({ ok: true });
  });
  it("handles do-not-contact through its dedicated action and admin-only lifting", () => {
    expect(validateTransition("new", "do_not_contact", op)).toEqual({ ok: false, error: "use_do_not_contact_action" });
    expect(validateTransition("do_not_contact", "new", op)).toEqual({ ok: false, error: "admin_required" });
    expect(validateTransition("do_not_contact", "new", { ...op, isAdmin: true })).toEqual({ ok: true });
    expect(validateTransition("do_not_contact", "contacted", { ...op, isAdmin: true }).ok).toBe(false);
  });
  it("lists selectable statuses", () => {
    expect(selectableStatuses("contacted", op)).toEqual(["responded", "interested", "not_interested", "trial_registered", "converted"]);
  });
});

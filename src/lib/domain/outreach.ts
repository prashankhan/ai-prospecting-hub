export const OUTREACH_STATUSES = [
  "new", "draft", "ready_for_review", "approved", "contacted", "responded",
  "interested", "not_interested", "trial_registered", "converted", "do_not_contact",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  new: "New",
  draft: "Draft",
  ready_for_review: "Ready for review",
  approved: "Approved",
  contacted: "Contacted",
  responded: "Responded",
  interested: "Interested",
  not_interested: "Not interested",
  trial_registered: "Trial registered",
  converted: "Converted",
  do_not_contact: "Do not contact",
};

/** Statuses before a human has sent the first message. */
export const PRE_CONTACT: readonly OutreachStatus[] = ["new", "draft", "ready_for_review", "approved"];
/** Statuses after outreach was manually performed. */
export const POST_CONTACT: readonly OutreachStatus[] = [
  "contacted", "responded", "interested", "not_interested", "trial_registered", "converted",
];
/** Statuses that represent a manually recorded response from the prospect. */
export const RESPONSE_STATUSES: readonly OutreachStatus[] = [
  "responded", "interested", "not_interested", "trial_registered", "converted",
];

export function isPreContact(s: OutreachStatus) {
  return PRE_CONTACT.includes(s);
}
export function isPostContact(s: OutreachStatus) {
  return POST_CONTACT.includes(s);
}

export type TransitionError =
  | "same_status"
  | "do_not_contact"
  | "use_mark_contacted"
  | "requires_approved_draft"
  | "cannot_return_to_pre_contact"
  | "not_contacted_yet"
  | "use_do_not_contact_action"
  | "admin_required";

export interface TransitionContext {
  isAdmin: boolean;
  hasApprovedDraft: boolean;
}

/**
 * Validates an outreach status change. Business rules:
 *  - "contacted" can only be reached through the explicit "Mark contacted" confirmation,
 *    and only from an approved draft.
 *  - Once contacted, a prospect never returns to a pre-contact status (prevents repeat outreach).
 *  - Response outcomes can only be recorded after contact.
 *  - Do-not-contact is set through its dedicated action; only admins may lift it.
 */
export function validateTransition(
  from: OutreachStatus,
  to: OutreachStatus,
  ctx: TransitionContext,
  via: "status_change" | "mark_contacted" = "status_change",
): { ok: true } | { ok: false; error: TransitionError } {
  if (from === to) return { ok: false, error: "same_status" };

  if (from === "do_not_contact") {
    if (!ctx.isAdmin) return { ok: false, error: "admin_required" };
    // Lifting DNC returns the prospect to its pre-contact queue state.
    return to === "new" ? { ok: true } : { ok: false, error: "do_not_contact" };
  }
  if (to === "do_not_contact") return { ok: false, error: "use_do_not_contact_action" };

  if (to === "contacted") {
    if (via !== "mark_contacted") return { ok: false, error: "use_mark_contacted" };
    if (from !== "approved" || !ctx.hasApprovedDraft) return { ok: false, error: "requires_approved_draft" };
    return { ok: true };
  }

  if (isPostContact(from) && isPreContact(to)) return { ok: false, error: "cannot_return_to_pre_contact" };
  if (isPreContact(from) && RESPONSE_STATUSES.includes(to)) return { ok: false, error: "not_contacted_yet" };
  if (to === "approved" && !ctx.hasApprovedDraft) return { ok: false, error: "requires_approved_draft" };

  return { ok: true };
}

export const TRANSITION_ERROR_MESSAGES: Record<TransitionError, string> = {
  same_status: "The prospect already has this status.",
  do_not_contact: "This prospect is marked do not contact.",
  use_mark_contacted: "Use “Mark contacted” to confirm a message was sent.",
  requires_approved_draft: "Approve a message draft first.",
  cannot_return_to_pre_contact: "This prospect was already contacted and can't return to a pre-contact status.",
  not_contacted_yet: "Responses can only be recorded after the prospect was contacted.",
  use_do_not_contact_action: "Use the do-not-contact action so suppression is recorded.",
  admin_required: "Only administrators can lift do-not-contact.",
};

/** Statuses a user can pick in the generic status menu for a given current status. */
export function selectableStatuses(from: OutreachStatus, ctx: TransitionContext): OutreachStatus[] {
  return OUTREACH_STATUSES.filter((to) => validateTransition(from, to, ctx).ok);
}

// Friday night check (Appendix H): a plan row's first hold text -> a closed code. The text itself goes no further than this
// function; anything not listed is 'other'. The plan writers are the console's youth-plan.js and youth-profile-edit.js, and the
// stored text is cut to 200 characters, so each entry matches the start of the text. A name can ride inside a text
// (the waitFirst wording, a category), so the output is the code alone.
import type { HoldCode } from '../core/link-contract';

const STARTS: readonly (readonly [string, HoldCode])[] = [
  ['Waiting for parent form', 'waiting-parent-form'], ['Possible existing profile', 'possible-existing'], ['Same person?', 'same-person'],
  ['Fix the flagged items', 'flagged-items'], ['Check the match', 'check-match'], ['Siblings share one parent form', 'siblings'],
  ['Unreadable date', 'unreadable-date'], ['Both forms on one profile', 'both-forms'],
  ['Two forms for one student? Same name and birthday. Check in Elvanto', 'two-student-forms'], ['Unclear save — check in Elvanto', 'unclear-save'],
  ['Saved before, not in Elvanto now', 'saved-not-in-elvanto'], ['Form list too long', 'form-list-long'], ['Profile archived', 'profile-archived'],
  ['Approved but not linked', 'approved-not-linked'], ['Approved to someone else? Check in Elvanto', 'approved-elsewhere'],
  ['Linked profile unclear', 'linked-unclear'], ['Linked profile unreadable', 'linked-unreadable'], ['Linked profile differs', 'linked-differs'],
  ["Linked to a profile the form page doesn't confirm", 'linked-unconfirmed'], ['Duplicate search failed', 'duplicate-search-failed'],
  ['Too many possible profiles', 'too-many-profiles'], ['Picked profile no longer matches', 'picked-no-match'], ['Profile unreadable', 'profile-unreadable'],
  ['Parent category unknown', 'parent-category-unknown'], ['Location/Demographic not on the form', 'location-not-on-form'],
  ["Location to tick isn't set. Open Advanced › This location.", 'location-not-set'], ['Notes unreadable', 'notes-unreadable'],
  ['Parent mobile needs fixing', 'parent-mobile'], ['Step list too long', 'step-list-long'], ['Not in consent step 1 yet', 'not-in-step-1'],
  ['No student form', 'no-student-form'], ['Not found in consent step', 'not-in-consent-step'], ['Two consent forms', 'two-consent-forms'],
  ['Unsure consent form', 'unsure-consent-form'], ['Late consent form', 'late-consent-form'], ['Consent form unreadable', 'consent-unreadable'],
  ['Unmatched consent form', 'unmatched-consent-form'], ['Parent not texted yet', 'parent-not-texted'],
  ['Parent texted? Could not read', 'parent-texted-unreadable'], ['Parent texted? No dated record', 'parent-texted-no-record'],
  ['Parent texted, but no dated record', 'parent-texted-no-record'], ['Parent texted late', 'parent-texted-late'], ['Cannot edit ', 'cannot-edit'],
  ['Waiting for replies until ', 'waiting-replies'], ['Profile is in ', 'profile-in'],
  ['The first child on this form must be approved first', 'first-child-pending'],
];
// "<name>'s consent form must be approved first...": the name leads, so this one matches inside the text.
const NAMED_FIRST = "'s consent form must be approved first";

// Every entry matches by startsWith, including those Appendix H lists as exact: the stored text is cut to 200 characters and a few
// writers append a detail after the wording, so an exact match would drop them to 'other'.
export function classifyHold(text: string): HoldCode | 'other' {
  for (const [start, code] of STARTS) if (text.startsWith(start)) return code;
  return text.includes(NAMED_FIRST) ? 'first-child-pending' : 'other';
}

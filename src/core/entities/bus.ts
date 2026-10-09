import type { ID, ISODateString } from '../types/common';

export type BusGender = 'male' | 'female' | null;
export type EndsAt = 'church' | 'last_drop' | 'address';

export interface BusVehicle {
  id: ID; name: string; plate: string | null; seats: number; prefGrades: number[];
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null;
  sort: number; archived: boolean; createdAt: ISODateString; updatedAt: ISODateString;
}
export interface BusOwnCar {
  name: string; seats: number; plate: string | null;
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null;
}
/** id === leaderId. riderKeys are 's:<studentId>' | 'g:<guestId>'. */
export interface BusLeaderPrefs {
  id: ID; inPool: boolean; fixedVehicleId: ID | null; ownCar: BusOwnCar | null; lastOwnRiderKeys: string[]; prefGrades: number[];
}
export interface BusGuest {
  id: ID; firstName: string; lastName: string; grade: number | null; gender: BusGender;
  phone: string | null; linkedStudentId: ID | null; dismissed: boolean;
  createdAt: ISODateString; lastRiddenAt: ISODateString | null;
}
export interface BusAddress {
  id: ID; studentId: ID | null; guestId: ID | null; label: string; address: string; placeId: string | null;
  lastUsedAt: ISODateString; createdAt: ISODateString;
}
export interface BusUndoEntry { riderId: ID; runVehicleId: ID | null; stopOrder: number | null; pinned: boolean }
export interface BusRun {
  id: ID; serviceDate: string; version: number; availablePoolLeaderIds: ID[];
  lockBy: string | null; lockUntil: ISODateString | null;
  lastChangeBy: string | null; lastChangeAt: ISODateString | null;
  undoSnapshot: BusUndoEntry[] | null; undoUntil: ISODateString | null; createdAt: ISODateString;
}
export interface BusRunVehicle {
  id: ID; runId: ID; vehicleId: ID | null; ownerLeaderId: ID | null;
  name: string; seats: number; plate: string | null; running: boolean; leaderIds: ID[];
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null; colourIndex: number;
  // Who was on the car, copied whenever leaderIds is saved — survives a leader being deleted (Full Reset).
  leaderSnap: { id: ID; name: string; gender: BusGender }[];
}
export interface BusRunRider {
  id: ID; runId: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  addedBy: string; addedAt: ISODateString;
  snapName: string; snapGrade: number | null; snapGender: BusGender; snapAddress: string; snapPlaceId: string | null;
  droppedAt: ISODateString | null; droppedBy: string | null;
  // "Not riding" = soft-removed: the row stays for history but every tonight read ignores it.
  notRiding: boolean; noShow: boolean; note: string | null; wasGuest: boolean;
}
export interface BusRunEdit { id: ID; runId: ID; at: ISODateString; by: string; detail: string }
export interface BusConsent { id: ID; studentId: ID | null; guestId: ID | null; given: boolean; note: string; recordedBy: string; recordedAt: ISODateString }

// ---- view types returned by BusService ----
export interface BusEligibility { female: boolean; male: boolean; unknown: boolean }
export interface BusRunVehicleView extends BusRunVehicle {
  capacity: number; eligibility: BusEligibility; leaderNames: string[];
  // Task 7 (owner): true when this car holds >=1 girl rider but has no female leader among its
  // leaderIds — replaces the old "Only 1 girl" chip (that rule is gone; this is its hand-placement
  // equivalent, since Move/Fit-in don't enforce the hard female-leader constraint).
  needsFemaleLeader: boolean;
}
export interface BusRiderView {
  id: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  name: string; grade: number | null; gender: BusGender; address: string; placeId: string | null;
  // note/recordedBy/recordedAt are omitted for a non-coordinating 'leader' role (spec I1) —
  // they only ever see { given }.
  consent: { given: boolean; note?: string; recordedBy?: string; recordedAt?: string } | null;
  droppedAt: string | null; droppedBy: string | null;
}
export interface BusLeaderView { id: ID; name: string; gender: BusGender; inPool: boolean; fixedVehicleId: ID | null; prefGrades: number[] }
// Owner request: "Past riders" on the Tonight tab — people with a saved address who aren't on
// tonight's roster. addressId lets the SPA one-tap add them via the existing addRider path
// without re-entering the address; only the suburb is ever shown here (spec I2's rule).
export interface BusPastRiderView {
  studentId: ID | null; guestId: ID | null; addressId: ID; name: string; grade: number | null; suburb: string;
}
export interface BusRunView {
  run: { id: ID; serviceDate: string; version: number; readOnly: boolean;
         lastChangeBy: string | null; lastChangeAt: string | null;
         lockBy: string | null; lockUntil: string | null; undoUntil: string | null };
  vehicles: BusRunVehicleView[];
  riders: BusRiderView[];
  leaders: BusLeaderView[];
  availablePoolLeaderIds: ID[];
  fleet: BusVehicle[];
  canCoordinate: boolean;
  pendingNewPeople: number | null;   // null unless director/admin
  pastRiders: BusPastRiderView[];    // [] unless bus:roster; capped ~50, most recent first
  // Task 10 (owner): leaders on a car this week (any running vehicle's leaderIds + own-car
  // ownerLeaderId), names+ids only, unscoped by grade/quad — feeds the "who are you" picker so
  // it can offer a leader outside the login's own scope. Sorted by name.
  onCarLeaders: { id: ID; name: string }[];
}
export interface BusSearchHit {
  kind: 'student' | 'guest'; id: ID; name: string; grade: number | null; gender: BusGender;
  // Labels + suburb only (spec I2) — never the full saved street address. `street` (Task 3) is
  // the decrypted address's street part, always populated so the SPA can fall back to it when
  // `label` is blank on an address saved before the default-label fix.
  addresses: { id: ID; label: string; suburb: string; street: string }[];
}
export interface MyCarView {
  vehicle: BusRunVehicleView | null;
  stops: (BusRiderView & { mobile: string | null })[];
  churchAddress: string;
  churchPlaceId: string;
  ownCarDraft: { car: BusOwnCar | null; riderIds: ID[] } | null;
  onCarLeaders: { id: ID; name: string }[]; // Task 10 — same list as BusRunView, for a picker rendered from myCar()
}
export interface PendingGuestView {
  id: ID; name: string; grade: number | null; phone: string | null; createdAt: string;
  // byPhone: true when the match came from the guest's phone matching the student's own mobile
  // or parent phone (ranked first, deduped against the name-based matches below).
  suggestions: { studentId: ID; name: string; grade: number | null; byPhone: boolean }[];
}

export interface BusGenerateResult {
  placed: number;                     // riders the solver put in a car
  unassigned: number;                 // riders with no car after this generate (incl. own-car-less, no-pin, pinned-unassigned)
  noAddressPin: number;               // riders never sent to Google because their address has no place ID
  routeMin: Record<ID, number>;       // run vehicle id → drive minutes from this solve (not persisted)
  // Task 7 (owner, replaces the old "lone girl" rule): non-pinned girl riders left Unassigned
  // because no running car currently has a female leader.
  noFemaleLeader: number;
}

export interface BusAnalysisRider { riderId: ID; name: string; stop: number; detourMin: number; detourPct: number; flagged: boolean }
export interface BusAnalysisCar { runVehicleId: ID; name: string; colourIndex: number; routeMin: number; riders: BusAnalysisRider[] } // riders: biggest detour first
export interface BusAnalysisView {
  version: number;                 // run version this was worked out for (SPA shows "changed since" when it moves)
  detourMin: number; detourPct: number;
  cars: BusAnalysisCar[];
  unassigned: number; longestMin: number; totalMin: number;
}
export interface BusExtraCarsStop { name: string; suburb: string; arriveAt: string } // arriveAt = 'HH:mm' local
export interface BusExtraCarsCar {
  label: string; extra: boolean; riders: number; driveMinutes: number; finishAt: string; // finishAt = 'HH:mm' local
  stops: BusExtraCarsStop[];
}
export interface BusExtraCarsView {
  count: number; seats: number;
  before: { longestMin: number; totalMin: number; unassigned: number };
  after: { longestMin: number; totalMin: number; unassigned: number };
  cars: BusExtraCarsCar[]; // Task 8: existing cars by name, hypothetical ones as "Extra car N" — the "after" solve's full breakdown
}

export interface BusHistoryNight {
  id: ID; date: string; riders: number; placed: number; unassigned: number; dropped: number; notRiding: number; noShow: number;
  cars: number; seats: number; leaders: string[]; guests: number; firstTime: number;
  edits?: { at: string; by: string; detail: string }[];
}
export interface BusHistoryRide {
  runId: ID; date: string; riderId: ID; studentId: ID | null; guestId: ID | null; kind: 'student' | 'guest'; wasGuest: boolean;
  name: string; grade: number | null; gender: BusGender; car: string | null; carColour: number | null; runVehicleId: ID | null;
  leaders: string[]; stop: number | null; address: string; suburb: string;
  droppedAt: string | null; droppedBy: string | null; addedBy: string; notRiding: boolean; noShow: boolean; note: string | null;
}
export interface BusHistoryView { canEdit: boolean; nights: BusHistoryNight[]; rides: BusHistoryRide[] }

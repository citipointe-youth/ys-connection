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
  id: ID; inPool: boolean; fixedVehicleId: ID | null; ownCar: BusOwnCar | null; lastOwnRiderKeys: string[];
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
}
export interface BusRunRider {
  id: ID; runId: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  addedBy: string; addedAt: ISODateString;
  snapName: string; snapGrade: number | null; snapGender: BusGender; snapAddress: string; snapPlaceId: string | null;
  droppedAt: ISODateString | null; droppedBy: string | null;
}
export interface BusConsent { id: ID; studentId: ID | null; guestId: ID | null; given: boolean; note: string; recordedBy: string; recordedAt: ISODateString }

// ---- view types returned by BusService ----
export interface BusEligibility { female: boolean; male: boolean; unknown: boolean }
export interface BusRunVehicleView extends BusRunVehicle {
  capacity: number; eligibility: BusEligibility; leaderNames: string[];
}
export interface BusRiderView {
  id: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  name: string; grade: number | null; gender: BusGender; address: string; placeId: string | null;
  consent: { given: boolean; note: string; recordedBy: string; recordedAt: string } | null;
  droppedAt: string | null; droppedBy: string | null;
}
export interface BusLeaderView { id: ID; name: string; gender: BusGender; inPool: boolean; fixedVehicleId: ID | null }
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
}
export interface BusSearchHit {
  kind: 'student' | 'guest'; id: ID; name: string; grade: number | null; gender: BusGender;
  addresses: { id: ID; label: string; address: string }[];
}
export interface MyCarView {
  vehicle: BusRunVehicleView | null;
  stops: (BusRiderView & { mobile: string | null })[];
  churchAddress: string;
  ownCarDraft: { car: BusOwnCar | null; riderIds: ID[] } | null;
}
export interface PendingGuestView {
  id: ID; name: string; grade: number | null; phone: string | null; createdAt: string;
  suggestions: { studentId: ID; name: string; grade: number | null }[];
}

import type { IBusRepository } from '../interfaces/entity-repositories';
import type { BusVehicle, BusLeaderPrefs, BusGuest, BusAddress, BusRun, BusRunVehicle, BusRunRider, BusConsent, BusUndoEntry } from '../../core/entities/bus';

const c = <T>(v: T): T => structuredClone(v);

export class InMemoryBusRepository implements IBusRepository {
  private vehicles = new Map<string, BusVehicle>();
  private prefs = new Map<string, BusLeaderPrefs>();
  private guests = new Map<string, BusGuest>();
  private addresses = new Map<string, BusAddress>();
  private runs = new Map<string, BusRun>();
  private runVehicles = new Map<string, BusRunVehicle>();
  private riders = new Map<string, BusRunRider>();
  private consents = new Map<string, BusConsent>();

  async init(): Promise<void> {}

  async listVehicles() { return [...this.vehicles.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map(c); }
  async getVehicle(id: string) { const v = this.vehicles.get(id); return v ? c(v) : null; }
  async saveVehicle(v: BusVehicle) { this.vehicles.set(v.id, c(v)); return c(v); }

  async listLeaderPrefs() { return [...this.prefs.values()].map(c); }
  async getLeaderPrefs(id: string) { const p = this.prefs.get(id); return p ? c(p) : null; }
  async saveLeaderPrefs(p: BusLeaderPrefs) { this.prefs.set(p.id, c(p)); return c(p); }

  async listGuests() { return [...this.guests.values()].map(c); }
  async getGuest(id: string) { const g = this.guests.get(id); return g ? c(g) : null; }
  async saveGuest(g: BusGuest) { this.guests.set(g.id, c(g)); return c(g); }
  async deleteGuest(id: string) {
    this.guests.delete(id);
    for (const [k, a] of this.addresses) if (a.guestId === id) this.addresses.delete(k);
    for (const [k, c] of this.consents) if (c.guestId === id) this.consents.delete(k);
  }

  async listAddresses(o: { studentId?: string; guestId?: string }) {
    return [...this.addresses.values()]
      .filter((a) => (o.studentId ? a.studentId === o.studentId : a.guestId === o.guestId))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).map(c);
  }
  async listAllAddresses() { return [...this.addresses.values()].map(c); }
  async getAddress(id: string) { const a = this.addresses.get(id); return a ? c(a) : null; }
  async saveAddress(a: BusAddress) { this.addresses.set(a.id, c(a)); return c(a); }
  async deleteAddress(id: string) { this.addresses.delete(id); }
  async deleteAddressesOf(o: { studentId?: string; guestId?: string }) {
    for (const [k, a] of this.addresses) if (o.studentId ? a.studentId === o.studentId : a.guestId === o.guestId) this.addresses.delete(k);
  }
  async reassignGuestAddresses(guestId: string, studentId: string) {
    for (const a of this.addresses.values()) if (a.guestId === guestId) { a.guestId = null; a.studentId = studentId; }
  }

  async getRunByDate(d: string) { const r = [...this.runs.values()].find((x) => x.serviceDate === d); return r ? c(r) : null; }
  async getRun(id: string) { const r = this.runs.get(id); return r ? c(r) : null; }
  async listRuns() { return [...this.runs.values()].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate)).map(c); }
  async insertRunIfAbsent(r: BusRun) {
    const existing = await this.getRunByDate(r.serviceDate);
    if (existing) return { run: existing, created: false };
    this.runs.set(r.id, c(r));
    return { run: c(r), created: true };
  }
  async bumpRun(id: string, by: string, at: string) {
    const r = this.runs.get(id);
    if (!r) throw new Error('run not found');
    r.version += 1; r.lastChangeBy = by; r.lastChangeAt = at;
    return c(r);
  }

  async listRunVehicles(runId: string) { return [...this.runVehicles.values()].filter((v) => v.runId === runId).sort((a, b) => a.colourIndex - b.colourIndex).map(c); }
  async saveRunVehicle(v: BusRunVehicle) { this.runVehicles.set(v.id, c(v)); return c(v); }
  async deleteRunVehicle(id: string) {
    this.runVehicles.delete(id);
    for (const r of this.riders.values()) if (r.runVehicleId === id) { r.runVehicleId = null; r.stopOrder = null; }
  }

  async listRunRiders(runId: string) { return [...this.riders.values()].filter((r) => r.runId === runId).sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map(c); }
  async getRunRider(id: string) { const r = this.riders.get(id); return r ? c(r) : null; }
  async saveRunRider(r: BusRunRider) { this.riders.set(r.id, c(r)); return c(r); }
  async deleteRunRider(id: string) { this.riders.delete(id); }

  async listConsents() { return [...this.consents.values()].map(c); }
  async getConsent(o: { studentId?: string; guestId?: string }) {
    const x = [...this.consents.values()].find((k) => (o.studentId ? k.studentId === o.studentId : k.guestId === o.guestId));
    return x ? c(x) : null;
  }
  async saveConsent(k: BusConsent) { this.consents.set(k.id, c(k)); return c(k); }
  async reassignGuestConsent(guestId: string, studentId: string) {
    const g = [...this.consents.values()].find((k) => k.guestId === guestId);
    if (!g) return;
    if ([...this.consents.values()].some((k) => k.studentId === studentId)) { this.consents.delete(g.id); return; }
    g.guestId = null; g.studentId = studentId;
  }

  async tryLock(id: string, by: string, nowIso: string, untilIso: string) {
    const r = this.runs.get(id);
    if (!r || (r.lockUntil && r.lockUntil > nowIso)) return null;
    // I3: bump the version so other phones' 10s version poll notices the lock and shows
    // "<name> is generating routes…" instead of staying on a stale, unlocked-looking view.
    r.lockBy = by; r.lockUntil = untilIso; r.version += 1;
    return c(r);
  }
  async releaseLock(id: string, by: string) { // I3 (version bump) + M1 (only clear a lock `by` still holds)
    const r = this.runs.get(id);
    if (r && r.lockBy === by) { r.lockBy = null; r.lockUntil = null; r.version += 1; }
  }
  async setUndo(id: string, snap: BusUndoEntry[] | null, until: string | null) {
    const r = this.runs.get(id); if (r) { r.undoSnapshot = snap ? c(snap) : null; r.undoUntil = until; }
  }
  async setPoolIds(id: string, ids: string[]) { const r = this.runs.get(id); if (r) r.availablePoolLeaderIds = [...ids]; }
}

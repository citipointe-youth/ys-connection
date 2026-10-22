// Operator 2026-10-23: GET /bus/places/details fills the consent form's five address lines from a picked suggestion.
import { describe, it, expect, vi } from 'vitest';
import { busFixture, stubRouting } from './helpers/bus-fixtures';
import { parseAddressDetails } from '../services/routing/google-requests';
import { GoogleRoutingProvider } from '../services/routing/google-routing-provider';
import { RoutingError } from '../services/routing/routing-provider';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';

const comp = (longText: string, types: string[], shortText = longText) => ({ longText, shortText, types });

describe('parseAddressDetails (Places API (New) addressComponents)', () => {
  it('a unit: number + street in line 1, "Unit N" in line 2, suburb, postcode, short state', () => {
    expect(parseAddressDetails({ formattedAddress: '3/12 Test St, Carina QLD 4152, Australia', addressComponents: [
      comp('3', ['subpremise']), comp('12', ['street_number']), comp('Test Street', ['route'], 'Test St'), comp('Carina', ['locality', 'political']),
      comp('Brisbane City', ['administrative_area_level_2', 'political']), comp('Queensland', ['administrative_area_level_1', 'political'], 'QLD'),
      comp('Australia', ['country', 'political'], 'AU'), comp('4152', ['postal_code'])] }))
      .toEqual({ line1: '12 Test Street', line2: 'Unit 3', city: 'Carina', postcode: '4152', state: 'QLD' });
  });
  it('no unit: line 2 blank', () => {
    expect(parseAddressDetails({ addressComponents: [comp('5', ['street_number']), comp('Other Road', ['route']), comp('Testville', ['locality']),
      comp('Queensland', ['administrative_area_level_1'], 'QLD'), comp('4000', ['postal_code'])] }))
      .toEqual({ line1: '5 Other Road', line2: '', city: 'Testville', postcode: '4000', state: 'QLD' });
  });
  it('a street with no number keeps the street; empty JSON gives empty lines, never throws', () => {
    expect(parseAddressDetails({ addressComponents: [comp('Long Lane', ['route']), comp('Carina', ['locality'])] }).line1).toBe('Long Lane');
    expect(parseAddressDetails(null)).toEqual({ line1: '', line2: '', city: '', postcode: '', state: '' });
  });
});

describe('GoogleRoutingProvider.addressDetails', () => {
  it('asks Place Details for addressComponents + formattedAddress with the session token; logs no address', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ addressComponents: [comp('5', ['street_number']), comp('Other Road', ['route'])] }), { status: 200 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = new GoogleRoutingProvider({ apiKey: 'k', saEmail: 'e', saPrivateKey: 'p', projectId: 'x' } as any, fetchFn as any);
    const a = await g.addressDetails('ChIJabc', 'sess-0001', AbortSignal.timeout(1000));
    expect(a.line1).toBe('5 Other Road');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc?sessionToken=sess-0001');
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('addressComponents,formattedAddress');
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});

describe('BusService.placeDetails', () => {
  it('maps through the provider (fake: unit and no-unit)', async () => {
    const f = await busFixture();
    expect(await f.svc.placeDetails(f.admin, 'fake:unit-3-12-test-st:1', 'sess-0001'))
      .toEqual({ line1: '1 12 test st', line2: 'Unit 3', city: 'Testville', postcode: '4000', state: 'QLD' });
    expect((await f.svc.placeDetails(f.ctx('leader'), 'fake:other-rd:2', 'x')).line2).toBe('');
  });
  it('refuses without bus:use, and a bad place id', async () => {
    const f = await busFixture();
    await expect(f.svc.placeDetails(f.ctx('nobody'), 'fake:a:1', 's')).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.svc.placeDetails(f.admin, 'bad id with spaces', 's')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('a Google error is a 502 ROUTING_FAILED with the search message (the SPA falls back to manual entry)', async () => {
    const f = await busFixture({ routing: stubRouting({ addressDetails: async () => { throw new RoutingError('Google address details failed (500)'); } }) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(f.svc.placeDetails(f.admin, 'ChIJabc', 's')).rejects.toMatchObject({ statusCode: 502, code: 'ROUTING_FAILED' });
    vi.restoreAllMocks();
  });
  it('the route is registered and authenticated', async () => {
    const { services } = await buildContainer();
    const r = buildRoutes(services).find((x) => x.method === 'GET' && x.path === '/bus/places/details');
    expect(r?.auth).toBe(true);
  });
});

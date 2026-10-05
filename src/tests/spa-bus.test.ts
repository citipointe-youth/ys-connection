import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

describe('SPA bus helpers', () => {
  it('_busLocalNow formats phone local time', () => {
    const { _busLocalNow } = loadFns(['_busLocalNow']);
    expect(_busLocalNow(new Date(2026, 9, 9, 19, 5))).toBe('2026-10-09T19:05');
  });
  it('_busSuburb mirrors the server helper', () => {
    const { _busSuburb } = loadFns(['_busSuburb']);
    expect(_busSuburb('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
  });
  it('module hooks exist and no emoji were introduced', () => {
    const html = loadIndexHtml();
    expect(html).toContain('/* ── BUS MODULE ── */');
    const block = html.slice(html.indexOf('/* ── BUS MODULE ── */'), html.indexOf('/* ── END BUS MODULE ── */'));
    expect(/\p{Extended_Pictographic}/u.test(block)).toBe(false);
  });
});

describe('maps links', () => {
  it('one link up to 9 stops; split above; ends follow the car', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = Array.from({ length: 11 }, (_, i) => ({ address: `${i + 1} A St, Carina`, placeId: null }));
    const links = _busMapsLinks(stops, '1 Church Rd, Carindale', { endsAt: 'church' });
    expect(links.map((l: { label: string }) => l.label)).toEqual(['Stops 1–9', 'Stops 10–11']);
    expect(links[0].url).toContain('origin=1%20Church%20Rd');
    expect(links[1].url).toContain('destination=1%20Church%20Rd');
    const one = _busMapsLinks(stops.slice(0, 3), '1 Church Rd', { endsAt: 'last_drop' });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe('Start in Google Maps');
    expect(one[0].url).toContain('destination=3%20A%20St');
  });
});

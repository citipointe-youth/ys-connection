export interface LatLng { lat: number; lng: number }

// Google's encoded polyline algorithm (precision 1e5).
export function encodePolyline(points: LatLng[]): string {
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) { r += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; }
    return r + String.fromCharCode(s + 63);
  };
  let out = '', pLat = 0, pLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

export function decodePolyline(s: string): LatLng[] {
  const pts: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) { lat += next(); lng += next(); pts.push({ lat: lat / 1e5, lng: lng / 1e5 }); }
  return pts;
}

/** Keeps at most maxPoints (first and last always kept) so a static-map URL stays short. */
export function thinPolyline(s: string, maxPoints: number): string {
  const pts = decodePolyline(s);
  if (pts.length <= maxPoints) return s;
  const step = Math.ceil(pts.length / (maxPoints - 1));
  const kept = pts.filter((_, i) => i % step === 0);
  kept.push(pts[pts.length - 1]!);
  return encodePolyline(kept);
}

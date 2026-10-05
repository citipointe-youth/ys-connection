import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../api/http/express-adapter';
import { RawResponse } from '../api/http/types';
import type { AuthService } from '../services/auth.service';

describe('RawResponse', () => {
  it('sends the bytes with their content type instead of JSON', async () => {
    const app = createApp([{ method: 'GET', path: '/raw', auth: false,
      handler: async () => new RawResponse('image/png', new Uint8Array([137, 80, 78, 71])) }], {} as AuthService);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/raw`);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    } finally { server.close(); }
  });
});

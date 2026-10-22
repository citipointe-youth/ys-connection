// Task 10 / F4: the container wires newYouth into the bus service, so POST /bus/consent-form reaches sendBusConsent.
import { describe, it, expect, vi } from 'vitest';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { mergeMinistryConfig } from '../core/ministry-config';
import { actor, student } from './helpers/bus-setup';

describe('bus consent wiring (F4)', () => {
  it('POST /bus/consent-form calls services.newYouth.sendBusConsent with the body', async () => {
    const { services, repos } = await buildContainer();
    const cfg = (await repos.settings.getSettings()).ministryConfig;
    await repos.settings.updateSettings({ ministryConfig: mergeMinistryConfig(cfg, { modules: { busMinistry: true } }) });
    await repos.students.save(student('s1', 'Jess', 'Tran', 9, 'female'));
    const spy = vi.spyOn(services.newYouth, 'sendBusConsent').mockResolvedValue({ result: 'failed', dropoff: null } as any);
    const route = buildRoutes(services).find((r) => r.method === 'POST' && r.path === '/bus/consent-form')!;
    const body = { studentId: 's1', readOut: true, first: 'Jess', last: 'Tran' };
    const now = new Date().toISOString().slice(0, 16); // ctxOf wants the phone's local time near the server clock
    const res = await route.handler({ body, query: { now }, params: {}, ctx: actor('admin'), headers: {} } as any);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject(body);
    expect(res).toMatchObject({ result: 'failed' });
  });
});

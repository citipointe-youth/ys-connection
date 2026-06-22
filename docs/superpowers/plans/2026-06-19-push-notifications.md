# Push Notifications + Notification History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admin/director/quad leaders to send custom push notifications to subscribed PWA users, with a persistent notification history visible on every account's home page (auto-expires in 3 days, manually dismissable; senders can retract before expiry).

**Architecture:** Web Push API with VAPID signing via `web-push`. Notifications are stored in two Supabase tables (`notifications` + `notification_recipients`). Push subscriptions stored in a third table. The service worker handles incoming pushes. Every home page shows received history; admin/director/quad also see a "Sent" section with early-delete capability.

**Tech Stack:** `web-push` (VAPID + push protocol), Supabase (3 new tables), existing TS/Express backend pattern, existing SPA conventions.

## Global Constraints

- No `.js` extensions on imports (ESM, `moduleResolution: "Bundler"`)
- Strict TypeScript: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`
- RBAC scattered checks are forbidden — push adds its own `canActorSendTo` pure function, separate from `access-control.ts`
- No emoji in SPA output — SVG icons only
- Every new top-level API route prefix (`push`) must be added to `API_RE` in `public/sw.js` and the cache name bumped
- Commit after every task

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `src/core/entities/push-subscription.ts` | `PushSubscription` entity + `PushTarget` union |
| CREATE | `src/core/entities/notification.ts` | `Notification`, `NotificationRecipient`, `NotificationWithRecipient` |
| MODIFY | `src/repositories/interfaces/entity-repositories.ts` | Add `IPushSubscriptionRepository` + `INotificationRepository` |
| CREATE | `src/repositories/supabase/supabase.push-subscriptions.ts` | Supabase push subscription impl |
| CREATE | `src/repositories/supabase/supabase.notifications.ts` | Supabase notification + recipient impl |
| MODIFY | `src/repositories/supabase/index.ts` | Export both new Supabase repos |
| MODIFY | `src/repositories/in-memory/in-memory.repositories.ts` | Add `InMemoryPushSubscriptionRepository` + `InMemoryNotificationRepository` |
| CREATE | `src/services/push.service.ts` | All push logic: `canActorSendTo`, `getUsersForTarget`, `makePushService` |
| CREATE | `src/tests/push.service.test.ts` | Unit tests for pure functions + service methods |
| CREATE | `src/api/controllers/push.controller.ts` | 7 push endpoints |
| MODIFY | `src/api/http/router.ts` | Add 7 push routes |
| MODIFY | `src/container.ts` | Wire push sub repo + notification repo + push service |
| MODIFY | `src/config/env.ts` | Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| MODIFY | `public/sw.js` | `push`/`notificationclick` handlers, add `push` to `API_RE`, bump cache to `cms-v4` |
| MODIFY | `public/index.html` | Bell icon, subscription init, send modal, notification history section |
| CREATE | `docs/push_subscriptions.sql` | SQL migration (all 3 tables) to run in Supabase dashboard |

---

### Task 1: Dependency, VAPID Keys, DB Migration

**Files:**
- Modify: `package.json` (via npm install)
- Create: `docs/push_subscriptions.sql`
- Modify: `src/config/env.ts`

**Interfaces:**
- Produces: `env.VAPID_PUBLIC_KEY`, `env.VAPID_PRIVATE_KEY`, `env.VAPID_SUBJECT` (used in Task 5)
- Produces: 3 Supabase tables: `push_subscriptions`, `notifications`, `notification_recipients`

- [ ] **Step 1: Install web-push**

Run from `connection-made-simple/`:
```bash
npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Generate VAPID keys**

```bash
node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(JSON.stringify(k,null,2))"
```

Expected output:
```json
{
  "publicKey": "BXXXXXXXX...",
  "privateKey": "YXXXXXXXX..."
}
```

Save both values — generated once, never regenerated.

- [ ] **Step 3: Add env vars to `src/config/env.ts`**

Open `src/config/env.ts`. Current content:
```typescript
function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  PORT: parseInt(getEnv('PORT', '4300'), 10),
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PERSISTENCE: getEnv('PERSISTENCE', 'memory') as 'memory' | 'json' | 'supabase',
  DATA_DIR: getEnv('DATA_DIR', './data'),
  CORS_ORIGINS: getEnv('CORS_ORIGINS', '*').split(','),
  DATABASE_URL: process.env['DATABASE_URL'],
};
```

Replace with:
```typescript
function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  PORT: parseInt(getEnv('PORT', '4300'), 10),
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PERSISTENCE: getEnv('PERSISTENCE', 'memory') as 'memory' | 'json' | 'supabase',
  DATA_DIR: getEnv('DATA_DIR', './data'),
  CORS_ORIGINS: getEnv('CORS_ORIGINS', '*').split(','),
  DATABASE_URL: process.env['DATABASE_URL'],
  VAPID_PUBLIC_KEY: process.env['VAPID_PUBLIC_KEY'] ?? '',
  VAPID_PRIVATE_KEY: process.env['VAPID_PRIVATE_KEY'] ?? '',
  VAPID_SUBJECT: process.env['VAPID_SUBJECT'] ?? '',
};
```

- [ ] **Step 4: Add env vars to `.env.local`**

Add to `.env.local` (never commit):
```
VAPID_PUBLIC_KEY=<your generated publicKey>
VAPID_PRIVATE_KEY=<your generated privateKey>
VAPID_SUBJECT=mailto:987tom1@gmail.com
```

- [ ] **Step 5: Add VAPID env vars to Vercel project**

In Vercel dashboard → Settings → Environment Variables, add:
- `VAPID_PUBLIC_KEY` = generated public key
- `VAPID_PRIVATE_KEY` = generated private key (mark Sensitive)
- `VAPID_SUBJECT` = `mailto:987tom1@gmail.com`

- [ ] **Step 6: Create `docs/push_subscriptions.sql`**

```sql
-- Push notifications feature — run this in the Supabase SQL editor (ap-southeast-2)

-- 1. Push subscriptions (one row per device per user)
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

-- 2. Notification log (one row per send event)
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  sender_id   text not null references users(id) on delete cascade,
  target      jsonb not null,
  title       text not null,
  message     text not null,
  sent        integer not null default 0,
  failed      integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '3 days'),
  deleted_at  timestamptz
);
create index if not exists notifications_sender_id_idx on notifications(sender_id);
create index if not exists notifications_expires_at_idx on notifications(expires_at);

-- 3. Per-recipient rows (one row per user who received a notification)
create table if not exists notification_recipients (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null references notifications(id) on delete cascade,
  recipient_id     text not null references users(id) on delete cascade,
  dismissed_at     timestamptz,
  unique (notification_id, recipient_id)
);
create index if not exists notification_recipients_recipient_idx on notification_recipients(recipient_id);
create index if not exists notification_recipients_notif_idx on notification_recipients(notification_id);
```

Run this in Supabase dashboard → SQL Editor.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/config/env.ts docs/push_subscriptions.sql package.json package-lock.json
git commit -m "feat: install web-push, add VAPID env vars, DB migration (3 tables)"
```

---

### Task 2: Push Subscription Entity + Repository

**Files:**
- Create: `src/core/entities/push-subscription.ts`
- Modify: `src/repositories/interfaces/entity-repositories.ts` (add import + `IPushSubscriptionRepository`)
- Create: `src/repositories/supabase/supabase.push-subscriptions.ts`
- Modify: `src/repositories/supabase/index.ts`
- Modify: `src/repositories/in-memory/in-memory.repositories.ts` (add class)

**Interfaces:**
- Produces: `PushSubscription`, `PushTarget` (used by Tasks 3, 4)
- Produces: `IPushSubscriptionRepository` (used by Tasks 4, 5)
- Produces: `SupabasePushSubscriptionRepository`, `InMemoryPushSubscriptionRepository` (used by Task 5)

- [ ] **Step 1: Create `src/core/entities/push-subscription.ts`**

```typescript
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export type PushTarget =
  | { type: 'all' }
  | { type: 'quad'; quad: string }
  | { type: 'grade'; grade: number; gender: 'male' | 'female' };
```

- [ ] **Step 2: Add `IPushSubscriptionRepository` to `src/repositories/interfaces/entity-repositories.ts`**

Add import at the top of the file (with other entity imports):
```typescript
import type { PushSubscription } from '../../core/entities/push-subscription';
```

Add interface at the bottom of the file:
```typescript
export interface IPushSubscriptionRepository {
  init(): Promise<void>;
  findByUserId(userId: string): Promise<PushSubscription[]>;
  findByUserIds(userIds: string[]): Promise<PushSubscription[]>;
  upsert(sub: PushSubscription): Promise<PushSubscription>;
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}
```

- [ ] **Step 3: Create `src/repositories/supabase/supabase.push-subscriptions.ts`**

```typescript
import type { SqlClient } from './client';
import type { IPushSubscriptionRepository } from '../interfaces/entity-repositories';
import type { PushSubscription } from '../../core/entities/push-subscription';
import { generateId } from '../../utils/id';

function toSub(row: Record<string, unknown>): PushSubscription {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    endpoint: row['endpoint'] as string,
    p256dh: row['p256dh'] as string,
    auth: row['auth'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

export class SupabasePushSubscriptionRepository implements IPushSubscriptionRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findByUserId(userId: string): Promise<PushSubscription[]> {
    const rows = await this.sql`
      select * from push_subscriptions where user_id = ${userId}
    `;
    return rows.map(toSub);
  }

  async findByUserIds(userIds: string[]): Promise<PushSubscription[]> {
    if (userIds.length === 0) return [];
    const rows = await this.sql`
      select * from push_subscriptions where user_id = any(${userIds})
    `;
    return rows.map(toSub);
  }

  async upsert(sub: PushSubscription): Promise<PushSubscription> {
    const rows = await this.sql`
      insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      values (${sub.id}, ${sub.userId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${sub.createdAt})
      on conflict (user_id, endpoint) do update set
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        created_at = excluded.created_at
      returning *
    `;
    return toSub(rows[0]!);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    await this.sql`
      delete from push_subscriptions
      where user_id = ${userId} and endpoint = ${endpoint}
    `;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.sql`delete from push_subscriptions where user_id = ${userId}`;
  }
}
```

- [ ] **Step 4: Add export to `src/repositories/supabase/index.ts`**

Add at the end:
```typescript
export { SupabasePushSubscriptionRepository } from './supabase.push-subscriptions';
```

- [ ] **Step 5: Add `InMemoryPushSubscriptionRepository` to `src/repositories/in-memory/in-memory.repositories.ts`**

Add import alongside other entity imports at the top:
```typescript
import type { PushSubscription } from '../../core/entities/push-subscription';
```

Add `IPushSubscriptionRepository` to the existing interface import block from `'../interfaces/entity-repositories'`.

Add class at the end of the file:
```typescript
// ---------------------------------------------------------------------------
// Push Subscriptions
// ---------------------------------------------------------------------------
export class InMemoryPushSubscriptionRepository implements IPushSubscriptionRepository {
  private subs: PushSubscription[] = [];

  async init(): Promise<void> {}

  async findByUserId(userId: string): Promise<PushSubscription[]> {
    return this.subs.filter((s) => s.userId === userId).map((s) => ({ ...s }));
  }

  async findByUserIds(userIds: string[]): Promise<PushSubscription[]> {
    const set = new Set(userIds);
    return this.subs.filter((s) => set.has(s.userId)).map((s) => ({ ...s }));
  }

  async upsert(sub: PushSubscription): Promise<PushSubscription> {
    const idx = this.subs.findIndex(
      (s) => s.userId === sub.userId && s.endpoint === sub.endpoint,
    );
    if (idx >= 0) {
      this.subs[idx] = { ...sub };
    } else {
      this.subs.push({ ...sub });
    }
    return { ...sub };
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    this.subs = this.subs.filter(
      (s) => !(s.userId === userId && s.endpoint === endpoint),
    );
  }

  async deleteByUserId(userId: string): Promise<void> {
    this.subs = this.subs.filter((s) => s.userId !== userId);
  }
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/entities/push-subscription.ts \
        src/repositories/interfaces/entity-repositories.ts \
        src/repositories/supabase/supabase.push-subscriptions.ts \
        src/repositories/supabase/index.ts \
        src/repositories/in-memory/in-memory.repositories.ts
git commit -m "feat: push subscription entity, interface, Supabase + in-memory repos"
```

---

### Task 3: Notification Entity + Repository

**Files:**
- Create: `src/core/entities/notification.ts`
- Modify: `src/repositories/interfaces/entity-repositories.ts` (add import + `INotificationRepository`)
- Create: `src/repositories/supabase/supabase.notifications.ts`
- Modify: `src/repositories/supabase/index.ts`
- Modify: `src/repositories/in-memory/in-memory.repositories.ts` (add class)

**Interfaces:**
- Consumes: `PushTarget` from `./push-subscription` (Task 2 must be done first)
- Produces: `Notification`, `NotificationRecipient`, `NotificationWithRecipient` (used by Tasks 4, 5)
- Produces: `INotificationRepository` (used by Tasks 4, 5)
- Produces: `SupabaseNotificationRepository`, `InMemoryNotificationRepository` (used by Task 5)

- [ ] **Step 1: Create `src/core/entities/notification.ts`**

```typescript
import type { PushTarget } from './push-subscription';

export interface Notification {
  id: string;
  senderId: string;
  target: PushTarget;
  title: string;
  message: string;
  sent: number;
  failed: number;
  createdAt: string;
  expiresAt: string;
  deletedAt: string | null;
}

export interface NotificationRecipient {
  id: string;
  notificationId: string;
  recipientId: string;
  dismissedAt: string | null;
}

export type NotificationWithRecipient = Notification & { dismissedAt: string | null };
```

- [ ] **Step 2: Add `INotificationRepository` to `src/repositories/interfaces/entity-repositories.ts`**

Add import alongside existing entity imports at the top:
```typescript
import type { Notification, NotificationWithRecipient } from '../../core/entities/notification';
```

Add interface at the bottom of the file:
```typescript
export interface INotificationRepository {
  init(): Promise<void>;
  save(notification: Notification): Promise<Notification>;
  saveRecipients(notificationId: string, recipientIds: string[]): Promise<void>;
  findById(id: string): Promise<Notification | null>;
  findSentByUser(userId: string): Promise<Notification[]>;
  findReceivedByUser(userId: string): Promise<NotificationWithRecipient[]>;
  softDelete(id: string, deletedAt: string): Promise<void>;
  dismissForUser(notificationId: string, userId: string, dismissedAt: string): Promise<void>;
}
```

- [ ] **Step 3: Create `src/repositories/supabase/supabase.notifications.ts`**

```typescript
import type { SqlClient } from './client';
import type { INotificationRepository } from '../interfaces/entity-repositories';
import type { Notification, NotificationWithRecipient } from '../../core/entities/notification';
import type { PushTarget } from '../../core/entities/push-subscription';
import { generateId } from '../../utils/id';

function toNotification(row: Record<string, unknown>): Notification {
  return {
    id: row['id'] as string,
    senderId: row['sender_id'] as string,
    target: (typeof row['target'] === 'string' ? JSON.parse(row['target']) : row['target']) as PushTarget,
    title: row['title'] as string,
    message: row['message'] as string,
    sent: row['sent'] as number,
    failed: row['failed'] as number,
    createdAt: (row['created_at'] as Date).toISOString(),
    expiresAt: (row['expires_at'] as Date).toISOString(),
    deletedAt: row['deleted_at'] ? (row['deleted_at'] as Date).toISOString() : null,
  };
}

export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async save(notification: Notification): Promise<Notification> {
    const rows = await this.sql`
      insert into notifications
        (id, sender_id, target, title, message, sent, failed, created_at, expires_at, deleted_at)
      values
        (${notification.id}, ${notification.senderId}, ${JSON.stringify(notification.target)},
         ${notification.title}, ${notification.message}, ${notification.sent}, ${notification.failed},
         ${notification.createdAt}, ${notification.expiresAt}, ${notification.deletedAt ?? null})
      on conflict (id) do update set
        sent       = excluded.sent,
        failed     = excluded.failed,
        deleted_at = excluded.deleted_at
      returning *
    `;
    return toNotification(rows[0]!);
  }

  async saveRecipients(notificationId: string, recipientIds: string[]): Promise<void> {
    if (recipientIds.length === 0) return;
    const rows = recipientIds.map((rid) => ({
      id: generateId(),
      notification_id: notificationId,
      recipient_id: rid,
      dismissed_at: null,
    }));
    await this.sql`
      insert into notification_recipients ${this.sql(rows)}
      on conflict (notification_id, recipient_id) do nothing
    `;
  }

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.sql`select * from notifications where id = ${id}`;
    return rows[0] ? toNotification(rows[0]) : null;
  }

  async findSentByUser(userId: string): Promise<Notification[]> {
    const rows = await this.sql`
      select * from notifications
      where sender_id = ${userId}
        and deleted_at is null
        and expires_at > now()
      order by created_at desc
      limit 50
    `;
    return rows.map(toNotification);
  }

  async findReceivedByUser(userId: string): Promise<NotificationWithRecipient[]> {
    const rows = await this.sql`
      select n.*, nr.dismissed_at as recipient_dismissed_at
      from notifications n
      join notification_recipients nr on nr.notification_id = n.id
      where nr.recipient_id = ${userId}
        and n.deleted_at is null
        and n.expires_at > now()
        and nr.dismissed_at is null
      order by n.created_at desc
      limit 50
    `;
    return rows.map((row) => ({
      ...toNotification(row),
      dismissedAt: row['recipient_dismissed_at']
        ? (row['recipient_dismissed_at'] as Date).toISOString()
        : null,
    }));
  }

  async softDelete(id: string, deletedAt: string): Promise<void> {
    await this.sql`
      update notifications set deleted_at = ${deletedAt} where id = ${id}
    `;
  }

  async dismissForUser(notificationId: string, userId: string, dismissedAt: string): Promise<void> {
    await this.sql`
      update notification_recipients
      set dismissed_at = ${dismissedAt}
      where notification_id = ${notificationId} and recipient_id = ${userId}
    `;
  }
}
```

- [ ] **Step 4: Add export to `src/repositories/supabase/index.ts`**

Add at the end:
```typescript
export { SupabaseNotificationRepository } from './supabase.notifications';
```

- [ ] **Step 5: Add `InMemoryNotificationRepository` to `src/repositories/in-memory/in-memory.repositories.ts`**

Add imports alongside other entity imports at the top:
```typescript
import type { Notification, NotificationRecipient, NotificationWithRecipient } from '../../core/entities/notification';
```

Add `INotificationRepository` to the existing interface import block.

Add class at the end of the file:
```typescript
// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: Notification[] = [];
  private recipients: NotificationRecipient[] = [];

  async init(): Promise<void> {}

  async save(notification: Notification): Promise<Notification> {
    const idx = this.notifications.findIndex((n) => n.id === notification.id);
    if (idx >= 0) {
      this.notifications[idx] = { ...notification };
    } else {
      this.notifications.push({ ...notification });
    }
    return { ...notification };
  }

  async saveRecipients(notificationId: string, recipientIds: string[]): Promise<void> {
    for (const recipientId of recipientIds) {
      const exists = this.recipients.some(
        (r) => r.notificationId === notificationId && r.recipientId === recipientId,
      );
      if (!exists) {
        this.recipients.push({ id: generateId(), notificationId, recipientId, dismissedAt: null });
      }
    }
  }

  async findById(id: string): Promise<Notification | null> {
    return this.notifications.find((n) => n.id === id) ?? null;
  }

  async findSentByUser(userId: string): Promise<Notification[]> {
    const now = new Date().toISOString();
    return this.notifications
      .filter((n) => n.senderId === userId && n.deletedAt === null && n.expiresAt > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((n) => ({ ...n }));
  }

  async findReceivedByUser(userId: string): Promise<NotificationWithRecipient[]> {
    const now = new Date().toISOString();
    return this.recipients
      .filter((r) => r.recipientId === userId && r.dismissedAt === null)
      .flatMap((r) => {
        const n = this.notifications.find((n) => n.id === r.notificationId);
        if (!n || n.deletedAt !== null || n.expiresAt <= now) return [];
        return [{ ...n, dismissedAt: r.dismissedAt }];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }

  async softDelete(id: string, deletedAt: string): Promise<void> {
    const n = this.notifications.find((n) => n.id === id);
    if (n) n.deletedAt = deletedAt;
  }

  async dismissForUser(notificationId: string, userId: string, dismissedAt: string): Promise<void> {
    const r = this.recipients.find(
      (r) => r.notificationId === notificationId && r.recipientId === userId,
    );
    if (r) r.dismissedAt = dismissedAt;
  }
}
```

Note: `generateId` is already imported in this file from an existing repository. Confirm it is at the top, otherwise add: `import { generateId } from '../../utils/id';`

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/entities/notification.ts \
        src/repositories/interfaces/entity-repositories.ts \
        src/repositories/supabase/supabase.notifications.ts \
        src/repositories/supabase/index.ts \
        src/repositories/in-memory/in-memory.repositories.ts
git commit -m "feat: notification entity, interface, Supabase + in-memory repos"
```

---

### Task 4: Push Service + Tests

**Files:**
- Create: `src/services/push.service.ts`
- Create: `src/tests/push.service.test.ts`

**Interfaces:**
- Consumes: `PushSubscription`, `PushTarget` from `../core/entities/push-subscription`
- Consumes: `Notification`, `NotificationWithRecipient` from `../core/entities/notification`
- Consumes: `IPushSubscriptionRepository`, `INotificationRepository` from `../repositories/interfaces/entity-repositories`
- Consumes: `IUserRepository` from `../repositories/interfaces/entity-repositories`
- Consumes: `Actor`, `SafeUser` from `../core/entities/user`
- Consumes: `ForbiddenError`, `NotFoundError` from `../core/errors/app-error`
- Consumes: `quadGradesOf`, `quadGenderOf` from `./access-control`
- Consumes: `generateId` from `../utils/id`
- Produces: `PushService`, `makePushService`, `canActorSendTo`, `getUsersForTarget` (used by Task 5)

- [ ] **Step 1: Write the failing tests**

Create `src/tests/push.service.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { canActorSendTo, getUsersForTarget, makePushService } from '../services/push.service';
import type { Actor, SafeUser } from '../core/entities/user';
import type { PushTarget } from '../core/entities/push-subscription';

function actor(role: string, opts: { quad?: string; grade?: number } = {}): Actor {
  return {
    id: 'test', role: role as any, displayName: 'Test',
    grade: (opts.grade ?? null) as any,
    quad: (opts.quad ?? null) as any,
    gender: null,
  };
}

function user(id: string, opts: { role: string; grade?: number; quad?: string; email?: string }): SafeUser {
  return {
    id,
    displayName: 'Test',
    email: opts.email ?? `${id}@example.com`,
    role: opts.role as any,
    grade: (opts.grade ?? null) as any,
    quad: (opts.quad ?? null) as any,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };
}

// ── canActorSendTo ───────────────────────────────────────────────────────────

describe('canActorSendTo', () => {
  it('admin can send to any target', () => {
    const a = actor('admin');
    expect(canActorSendTo(a, { type: 'all' })).toBe(true);
    expect(canActorSendTo(a, { type: 'quad', quad: 'g79' })).toBe(true);
    expect(canActorSendTo(a, { type: 'grade', grade: 7, gender: 'female' })).toBe(true);
  });

  it('director can send to any target', () => {
    const a = actor('director');
    expect(canActorSendTo(a, { type: 'all' })).toBe(true);
    expect(canActorSendTo(a, { type: 'quad', quad: 'b1012' })).toBe(true);
    expect(canActorSendTo(a, { type: 'grade', grade: 12, gender: 'male' })).toBe(true);
  });

  it('quad cannot send to "all"', () => {
    expect(canActorSendTo(actor('quad', { quad: 'g79' }), { type: 'all' })).toBe(false);
  });

  it('quad can send to their own quad', () => {
    const a = actor('quad', { quad: 'g79' });
    expect(canActorSendTo(a, { type: 'quad', quad: 'g79' })).toBe(true);
    expect(canActorSendTo(a, { type: 'quad', quad: 'b79' })).toBe(false);
    expect(canActorSendTo(a, { type: 'quad', quad: 'g1012' })).toBe(false);
  });

  it('quad can send to grades in their bracket + gender only', () => {
    const g79 = actor('quad', { quad: 'g79' });
    expect(canActorSendTo(g79, { type: 'grade', grade: 7, gender: 'female' })).toBe(true);
    expect(canActorSendTo(g79, { type: 'grade', grade: 9, gender: 'female' })).toBe(true);
    expect(canActorSendTo(g79, { type: 'grade', grade: 10, gender: 'female' })).toBe(false);
    expect(canActorSendTo(g79, { type: 'grade', grade: 7, gender: 'male' })).toBe(false);

    const b1012 = actor('quad', { quad: 'b1012' });
    expect(canActorSendTo(b1012, { type: 'grade', grade: 10, gender: 'male' })).toBe(true);
    expect(canActorSendTo(b1012, { type: 'grade', grade: 12, gender: 'male' })).toBe(true);
    expect(canActorSendTo(b1012, { type: 'grade', grade: 9, gender: 'male' })).toBe(false);
    expect(canActorSendTo(b1012, { type: 'grade', grade: 10, gender: 'female' })).toBe(false);
  });

  it('grade login cannot send', () => {
    const a = actor('grade', { grade: 7 });
    expect(canActorSendTo(a, { type: 'all' })).toBe(false);
    expect(canActorSendTo(a, { type: 'grade', grade: 7, gender: 'female' })).toBe(false);
  });
});

// ── getUsersForTarget ────────────────────────────────────────────────────────

describe('getUsersForTarget', () => {
  const users: SafeUser[] = [
    user('admin1',  { role: 'admin',    email: 'admin@y.m' }),
    user('dir1',    { role: 'director', email: 'director@y.m' }),
    user('qg79',    { role: 'quad',     quad: 'g79',   email: 'g79@y.m' }),
    user('qb79',    { role: 'quad',     quad: 'b79',   email: 'b79@y.m' }),
    user('qg1012',  { role: 'quad',     quad: 'g1012', email: 'g1012@y.m' }),
    user('qb1012',  { role: 'quad',     quad: 'b1012', email: 'b1012@y.m' }),
    user('g7f',     { role: 'grade', grade: 7,  email: 'grade7g@y.m' }),
    user('g7m',     { role: 'grade', grade: 7,  email: 'grade7b@y.m' }),
    user('g9f',     { role: 'grade', grade: 9,  email: 'grade9g@y.m' }),
    user('g12m',    { role: 'grade', grade: 12, email: 'grade12b@y.m' }),
  ];

  it('all → returns every user', () => {
    expect(getUsersForTarget({ type: 'all' }, users)).toHaveLength(users.length);
  });

  it('quad g79 → returns only qg79', () => {
    const result = getUsersForTarget({ type: 'quad', quad: 'g79' }, users);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('qg79');
  });

  it('grade 7 female → returns only g7f', () => {
    const result = getUsersForTarget({ type: 'grade', grade: 7, gender: 'female' }, users);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('g7f');
  });

  it('grade 7 male → returns only g7m', () => {
    const result = getUsersForTarget({ type: 'grade', grade: 7, gender: 'male' }, users);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('g7m');
  });

  it('grade with no gender suffix is excluded from gendered targets', () => {
    const u = [user('g7none', { role: 'grade', grade: 7, email: 'grade7@y.m' })];
    expect(getUsersForTarget({ type: 'grade', grade: 7, gender: 'female' }, u)).toHaveLength(0);
  });
});

// ── send + notification logging ──────────────────────────────────────────────

describe('makePushService.send', () => {
  it('throws ForbiddenError when grade login tries to send', async () => {
    const svc = makePushService({
      vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '',
      pushRepo: null as any, notifRepo: null as any, userRepo: null as any,
    });
    await expect(
      svc.send(actor('grade', { grade: 7 }), { type: 'all' }, 'T', 'M'),
    ).rejects.toThrow('Forbidden');
  });

  it('returns { sent: 0, failed: 0 } and saves a notification record when no devices subscribed', async () => {
    const savedNotif = { current: null as any };
    const savedRecipients = { ids: [] as string[] };

    const mockPushRepo = {
      init: vi.fn(), findByUserId: vi.fn(),
      findByUserIds: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(), deleteByEndpoint: vi.fn(), deleteByUserId: vi.fn(),
    };
    const mockNotifRepo = {
      init: vi.fn(),
      save: vi.fn().mockImplementation(async (n) => { savedNotif.current = n; return n; }),
      saveRecipients: vi.fn().mockImplementation(async (_id, ids) => { savedRecipients.ids = ids; }),
      findById: vi.fn(), findSentByUser: vi.fn(), findReceivedByUser: vi.fn(),
      softDelete: vi.fn(), dismissForUser: vi.fn(),
    };
    const mockUserRepo = {
      init: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn(), findByEmail: vi.fn(), findByRole: vi.fn(),
      save: vi.fn(), delete: vi.fn(),
    };

    const svc = makePushService({
      vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '',
      pushRepo: mockPushRepo as any,
      notifRepo: mockNotifRepo as any,
      userRepo: mockUserRepo as any,
    });

    const result = await svc.send(actor('admin'), { type: 'all' }, 'Title', 'Hello');
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockNotifRepo.save).toHaveBeenCalledOnce();
    expect(savedNotif.current.title).toBe('Title');
    expect(savedNotif.current.message).toBe('Hello');
    expect(savedNotif.current.senderId).toBe('test');
    expect(savedNotif.current.deletedAt).toBeNull();
  });
});

// ── deleteNotification ───────────────────────────────────────────────────────

describe('makePushService.deleteNotification', () => {
  function makeRepos(notif: any) {
    return {
      pushRepo: null as any,
      notifRepo: {
        init: vi.fn(),
        save: vi.fn(), saveRecipients: vi.fn(),
        findById: vi.fn().mockResolvedValue(notif),
        findSentByUser: vi.fn(), findReceivedByUser: vi.fn(),
        softDelete: vi.fn().mockResolvedValue(undefined),
        dismissForUser: vi.fn(),
      },
      userRepo: null as any,
    };
  }

  it('throws ForbiddenError when non-sender tries to delete', async () => {
    const repos = makeRepos({ id: 'n1', senderId: 'other-user' });
    const svc = makePushService({ vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '', ...repos });
    await expect(
      svc.deleteNotification(actor('admin'), 'n1'),
    ).rejects.toThrow('Forbidden');
  });

  it('calls softDelete when sender deletes their notification', async () => {
    const repos = makeRepos({ id: 'n1', senderId: 'test' });
    const svc = makePushService({ vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '', ...repos });
    await svc.deleteNotification(actor('admin'), 'n1');
    expect(repos.notifRepo.softDelete).toHaveBeenCalledWith('n1', expect.any(String));
  });

  it('throws NotFoundError for unknown id', async () => {
    const repos = makeRepos(null);
    const svc = makePushService({ vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '', ...repos });
    await expect(svc.deleteNotification(actor('admin'), 'bad')).rejects.toThrow('Not Found');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm run test -- push.service
```

Expected: FAIL — `Cannot find module '../services/push.service'`

- [ ] **Step 3: Create `src/services/push.service.ts`**

```typescript
import webpush from 'web-push';
import type { Actor, SafeUser, User } from '../core/entities/user';
import type { PushSubscription, PushTarget } from '../core/entities/push-subscription';
import type { Notification, NotificationWithRecipient } from '../core/entities/notification';
import type {
  IPushSubscriptionRepository,
  INotificationRepository,
  IUserRepository,
} from '../repositories/interfaces/entity-repositories';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import { quadGradesOf, quadGenderOf } from './access-control';
import { generateId } from '../utils/id';

// ── Pure functions (exported for testing) ───────────────────────────────────

export function canActorSendTo(actor: Actor, target: PushTarget): boolean {
  if (actor.role === 'admin' || actor.role === 'director') return true;
  if (actor.role !== 'quad') return false;
  const grades = quadGradesOf(actor.quad!);
  const gender = quadGenderOf(actor.quad!);
  switch (target.type) {
    case 'all': return false;
    case 'quad': return actor.quad === target.quad;
    case 'grade': return grades.includes(target.grade) && target.gender === gender;
  }
}

function deriveGenderFromEmail(email: string): 'male' | 'female' | null {
  const username = email.split('@')[0]?.toLowerCase() ?? '';
  if (username.endsWith('g') || username.includes('girl')) return 'female';
  if (username.endsWith('b') || username.includes('boy')) return 'male';
  return null;
}

export function getUsersForTarget(target: PushTarget, users: SafeUser[]): SafeUser[] {
  switch (target.type) {
    case 'all': return users;
    case 'quad': return users.filter((u) => u.role === 'quad' && u.quad === target.quad);
    case 'grade':
      return users.filter((u) => {
        if (u.role !== 'grade' || u.grade !== target.grade) return false;
        return deriveGenderFromEmail(u.email) === target.gender;
      });
  }
}

function toSafe(u: User): SafeUser {
  const { passwordHash: _pw, ...safe } = u;
  return safe as SafeUser;
}

// ── Service types ────────────────────────────────────────────────────────────

export interface SendResult {
  sent: number;
  failed: number;
}

export interface ReceivedNotification extends NotificationWithRecipient {
  senderName: string;
}

export interface NotificationsResponse {
  received: ReceivedNotification[];
  sent: Notification[];
}

export interface PushService {
  getVapidPublicKey(): string;
  subscribe(actor: Actor, endpoint: string, p256dh: string, auth: string): Promise<void>;
  unsubscribe(actor: Actor, endpoint: string): Promise<void>;
  send(actor: Actor, target: PushTarget, title: string, message: string): Promise<SendResult>;
  getNotificationsForUser(actor: Actor): Promise<NotificationsResponse>;
  deleteNotification(actor: Actor, id: string): Promise<void>;
  dismissNotification(actor: Actor, id: string): Promise<void>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function makePushService(opts: {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  pushRepo: IPushSubscriptionRepository;
  notifRepo: INotificationRepository;
  userRepo: IUserRepository;
}): PushService {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject, pushRepo, notifRepo, userRepo } = opts;

  if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  }

  return {
    getVapidPublicKey() {
      return vapidPublicKey;
    },

    async subscribe(actor, endpoint, p256dh, auth) {
      const sub: PushSubscription = {
        id: generateId(),
        userId: actor.id,
        endpoint,
        p256dh,
        auth,
        createdAt: new Date().toISOString(),
      };
      await pushRepo.upsert(sub);
    },

    async unsubscribe(actor, endpoint) {
      await pushRepo.deleteByEndpoint(actor.id, endpoint);
    },

    async send(actor, target, title, message) {
      if (!canActorSendTo(actor, target)) {
        throw new ForbiddenError('You are not allowed to send to this target');
      }

      const allUsers = await userRepo.findAll();
      const safeUsers = allUsers.map(toSafe);
      const targetUsers = getUsersForTarget(target, safeUsers);
      const userIds = targetUsers.map((u) => u.id);
      const subs = await pushRepo.findByUserIds(userIds);

      const payload = JSON.stringify({
        title,
        body: message,
        icon: '/icons/icon.svg',
        badge: '/icons/icon.svg',
      });

      let sent = 0;
      let failed = 0;

      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
            );
            sent++;
          } catch (err: unknown) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 410 || status === 404) {
              await pushRepo.deleteByEndpoint(sub.userId, sub.endpoint);
            }
            failed++;
          }
        }),
      );

      const now = new Date().toISOString();
      const notif: Notification = {
        id: generateId(),
        senderId: actor.id,
        target,
        title,
        message,
        sent,
        failed,
        createdAt: now,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        deletedAt: null,
      };
      await notifRepo.save(notif);
      await notifRepo.saveRecipients(notif.id, userIds);

      return { sent, failed };
    },

    async getNotificationsForUser(actor) {
      const canSend = actor.role === 'admin' || actor.role === 'director' || actor.role === 'quad';
      const [received, sentRaw, allUsers] = await Promise.all([
        notifRepo.findReceivedByUser(actor.id),
        canSend ? notifRepo.findSentByUser(actor.id) : Promise.resolve([]),
        notifRepo.findReceivedByUser(actor.id).then(() => userRepo.findAll()),
      ]);
      const allUsersResolved = await userRepo.findAll();
      const nameById = new Map(allUsersResolved.map((u) => [u.id, u.displayName]));
      return {
        received: received.map((n) => ({
          ...n,
          senderName: nameById.get(n.senderId) ?? 'Unknown',
        })),
        sent: sentRaw,
      };
    },

    async deleteNotification(actor, id) {
      const notif = await notifRepo.findById(id);
      if (!notif) throw new NotFoundError('Notification not found');
      if (notif.senderId !== actor.id) {
        throw new ForbiddenError('You can only delete notifications you sent');
      }
      await notifRepo.softDelete(id, new Date().toISOString());
    },

    async dismissNotification(actor, id) {
      await notifRepo.dismissForUser(id, actor.id, new Date().toISOString());
    },
  };
}
```

> **Note:** The `getNotificationsForUser` method has a redundant `Promise.all` on line 3 of its body — simplify it: just call `userRepo.findAll()` and `notifRepo.findReceivedByUser` in a `Promise.all([received, sentRaw, allUsers])` together. The final implementation should be:
>
> ```typescript
> async getNotificationsForUser(actor) {
>   const canSend = actor.role === 'admin' || actor.role === 'director' || actor.role === 'quad';
>   const [received, sentRaw, allUsers] = await Promise.all([
>     notifRepo.findReceivedByUser(actor.id),
>     canSend ? notifRepo.findSentByUser(actor.id) : Promise.resolve([]),
>     userRepo.findAll(),
>   ]);
>   const nameById = new Map(allUsers.map((u) => [u.id, u.displayName]));
>   return {
>     received: received.map((n) => ({ ...n, senderName: nameById.get(n.senderId) ?? 'Unknown' })),
>     sent: sentRaw,
>   };
> },
> ```

Use the simplified version above in the actual file.

- [ ] **Step 4: Run tests — expect passing**

```bash
npm run test -- push.service
```

Expected:
```
✓ canActorSendTo > admin can send to any target
✓ canActorSendTo > director can send to any target
✓ canActorSendTo > quad cannot send to "all"
✓ canActorSendTo > quad can send to their own quad
✓ canActorSendTo > quad can send to grades in their bracket + gender only
✓ canActorSendTo > grade login cannot send
✓ getUsersForTarget > all → returns every user
✓ getUsersForTarget > quad g79 → returns only qg79
✓ getUsersForTarget > grade 7 female → returns only g7f
✓ getUsersForTarget > grade 7 male → returns only g7m
✓ getUsersForTarget > grade with no gender suffix is excluded
✓ makePushService.send > throws ForbiddenError when grade login tries to send
✓ makePushService.send > returns { sent: 0, failed: 0 } and saves a notification record
✓ makePushService.deleteNotification > throws ForbiddenError when non-sender tries to delete
✓ makePushService.deleteNotification > calls softDelete when sender deletes
✓ makePushService.deleteNotification > throws NotFoundError for unknown id
16 tests passed
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: all existing tests pass + 16 new.

- [ ] **Step 6: Commit**

```bash
git add src/services/push.service.ts src/tests/push.service.test.ts
git commit -m "feat: push service — send, notification logging, history, delete, dismiss"
```

---

### Task 5: Push Controller + Routes + Container Wiring

**Files:**
- Create: `src/api/controllers/push.controller.ts`
- Modify: `src/api/http/router.ts`
- Modify: `src/container.ts`

**Interfaces:**
- Consumes: `PushService`, `makePushService` from `../../services/push.service`
- Consumes: `SupabasePushSubscriptionRepository`, `InMemoryPushSubscriptionRepository`
- Consumes: `SupabaseNotificationRepository`, `InMemoryNotificationRepository`
- Consumes: `IPushSubscriptionRepository`, `INotificationRepository`
- Produces: 7 HTTP endpoints (see routes section)

**API produced:**

| Method | Path | Auth | Who |
|--------|------|------|-----|
| `GET` | `/push/vapid-key` | no | everyone |
| `POST` | `/push/subscribe` | yes | everyone |
| `DELETE` | `/push/subscribe` | yes | everyone |
| `POST` | `/push/send` | yes | admin, director, quad |
| `GET` | `/push/notifications` | yes | everyone |
| `DELETE` | `/push/notifications/:id` | yes | sender only |
| `POST` | `/push/notifications/:id/dismiss` | yes | recipient only |

- [ ] **Step 1: Create `src/api/controllers/push.controller.ts`**

```typescript
import type { HttpRequest } from '../http/types';
import type { PushService } from '../../services/push.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export function makePushController(deps: { push: PushService }) {
  return {
    getVapidKey(_req: HttpRequest) {
      return { publicKey: deps.push.getVapidPublicKey() || null };
    },

    async subscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const { endpoint, keys } = (req.body ?? {}) as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw new BadRequestError('endpoint, keys.p256dh, and keys.auth are required');
      }
      await deps.push.subscribe(req.ctx, endpoint, keys.p256dh, keys.auth);
      return { ok: true };
    },

    async unsubscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const { endpoint } = (req.body ?? {}) as { endpoint?: string };
      if (!endpoint) throw new BadRequestError('endpoint is required');
      await deps.push.unsubscribe(req.ctx, endpoint);
      return { ok: true };
    },

    async send(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const { target, title, message } = (req.body ?? {}) as {
        target?: unknown;
        title?: string;
        message?: string;
      };
      if (!target || !message) throw new BadRequestError('target and message are required');
      return deps.push.send(req.ctx, target as any, title ?? 'Youth Ministry', message);
    },

    async getNotifications(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.push.getNotificationsForUser(req.ctx);
    },

    async deleteNotification(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('id is required');
      await deps.push.deleteNotification(req.ctx, id);
      return { ok: true };
    },

    async dismissNotification(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('id is required');
      await deps.push.dismissNotification(req.ctx, id);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 2: Add push routes to `src/api/http/router.ts`**

Add import at the top with the other controller imports:
```typescript
import { makePushController } from '../controllers/push.controller';
```

In `buildRoutes`, after the `lifegroupStats` controller line, add:
```typescript
  const push = makePushController({ push: services.push });
```

Add routes at the end of the returned array (before the closing `]`):
```typescript
    // ----- Push notifications -----
    { method: 'GET',    path: '/push/vapid-key',                   auth: false, handler: (r) => push.getVapidKey(r) },
    { method: 'POST',   path: '/push/subscribe',                   auth: true,  handler: (r) => push.subscribe(r) },
    { method: 'DELETE', path: '/push/subscribe',                   auth: true,  handler: (r) => push.unsubscribe(r) },
    { method: 'POST',   path: '/push/send',                        auth: true,  handler: (r) => push.send(r) },
    { method: 'GET',    path: '/push/notifications',               auth: true,  handler: (r) => push.getNotifications(r) },
    { method: 'DELETE', path: '/push/notifications/:id',           auth: true,  handler: (r) => push.deleteNotification(r) },
    { method: 'POST',   path: '/push/notifications/:id/dismiss',   auth: true,  handler: (r) => push.dismissNotification(r) },
```

- [ ] **Step 3: Wire push into `src/container.ts`**

Add to the in-memory imports block (the `import { InMemoryUserRepository, ... }` statement):
```
InMemoryPushSubscriptionRepository,
InMemoryNotificationRepository,
```

Add to the Supabase imports block (the `import { SupabaseUserRepository, ... }` statement):
```
SupabasePushSubscriptionRepository,
SupabaseNotificationRepository,
```

Add to the interface imports block (the `import type { IUserRepository, ... }` statement):
```
IPushSubscriptionRepository,
INotificationRepository,
```

Add after the existing service imports:
```typescript
import { makePushService, type PushService } from './services/push.service';
```

Add to the `Repositories` interface:
```typescript
  pushSubscriptions: IPushSubscriptionRepository;
  notifications: INotificationRepository;
```

Add to the `Services` interface:
```typescript
  push: PushService;
```

In `buildContainer()`, after the `audit` repo declaration:
```typescript
  const pushSubscriptions: IPushSubscriptionRepository = useSupabase
    ? new SupabasePushSubscriptionRepository(sql)
    : new InMemoryPushSubscriptionRepository();
  const notifications: INotificationRepository = useSupabase
    ? new SupabaseNotificationRepository(sql)
    : new InMemoryNotificationRepository();
```

Add both to the `repos` object:
```typescript
    pushSubscriptions, notifications,
```

Add both to `Promise.all([...])` init block:
```typescript
    pushSubscriptions.init(), notifications.init(),
```

After the `admin` service declaration:
```typescript
  const push = makePushService({
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY,
    vapidSubject: env.VAPID_SUBJECT,
    pushRepo: pushSubscriptions,
    notifRepo: notifications,
    userRepo: users,
  });
```

Add to the `services` object:
```typescript
    push,
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Smoke-test locally**

```bash
PERSISTENCE=memory npm run dev
```

Then in another terminal:
```bash
curl http://localhost:4300/push/vapid-key
```

Expected: `{"publicKey":null}` (VAPID keys not set in memory mode, or the key value if set in `.env.local`).

- [ ] **Step 6: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/api/controllers/push.controller.ts \
        src/api/http/router.ts \
        src/container.ts
git commit -m "feat: push controller (7 routes), container wiring for push + notification repos"
```

---

### Task 6: Service Worker Updates

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Replace `public/sw.js` with the following**

```javascript
const CACHE = 'cms-v4';
const APP_SHELL = ['/'];

// API paths that should never be served from cache. NOTE: every API resource must
// be listed here — a missing one falls through to the cache-first asset path and
// can get the SPA HTML cached under its URL, breaking JSON parsing.
const API_RE = /^\/(auth|students|leaders|connections|overview|trends|lifegroups|at-risk|import|settings|admin|accounts|health|push)(\/|$|\?)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (API_RE.test(url.pathname)) return;

  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'Youth Ministry', body: '' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin)) return client.focus();
        }
        return clients.openWindow('/');
      })
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "feat: SW push + notificationclick handlers, API_RE includes push, bump to cms-v4"
```

---

### Task 7: Client — Subscription Management + Send UI + Notification History

**Files:**
- Modify: `public/index.html`

This task has five sub-changes:
1. Add `bell` to the `IC` path registry
2. Add bell button to `_initShell()` for admin/director/quad
3. Add subscription init + helpers (`initPushSubscription`, `_doSubscribe`, `_urlBase64ToUint8Array`)
4. Add send notification modal (`showSendNotification`, `submitSendNotification`)
5. Add notification history section at bottom of home page (`_renderNotifHistory`, `dismissNotification`, `deleteNotification`, `_pushTargetLabel`, `_timeAgo`)
6. Call `initPushSubscription()` after login; append history section in `renderHome()`

> **Before starting:** `public/index.html` is ~4500 lines. Use `grep -n` to find exact line numbers for each change point before editing.

- [ ] **Step 1: Find the IC registry and add `bell`**

```bash
grep -n "const IC\s*=" public/index.html
```

Open the file at that line. The IC object ends with something like `xmark: '...'`. Add `bell` after it:

```javascript
  bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
```

Match the comma style of surrounding entries exactly.

- [ ] **Step 2: Find `_initShell` and add bell button**

```bash
grep -n "_initShell\|hdr-meta" public/index.html | head -10
```

In `_initShell()`, find the `hdr-meta` div. It currently renders:
```html
<div class="hdr-meta">
  ${roleBadge(u)}
  <div class="btn-icon" onclick="doLogout()" ...>${icN('logout')}</div>
</div>
```

Replace the `hdr-meta` div with:
```html
<div class="hdr-meta">
  ${roleBadge(u)}
  ${['admin','director','quad'].includes(u.role) ? `<div class="btn-icon" onclick="showSendNotification()" title="Send notification" aria-label="Send notification">${icN('bell')}</div>` : ''}
  <div class="btn-icon" onclick="doLogout()" title="Sign out" aria-label="Sign out">${icN('logout')}</div>
</div>
```

- [ ] **Step 3: Find the login success line and add `initPushSubscription()` call**

```bash
grep -n "S\.user = res\.user" public/index.html
```

This is at line 896: `API.setToken(res.token); S.user = res.user; go('home');`

After `go('home')` on that same line (or on the next line if it's split), add:
```javascript
initPushSubscription();
```

- [ ] **Step 4: Find `renderHome` and add notification history container**

```bash
grep -n "function renderHome\|async function renderHome" public/index.html
```

Inside `renderHome()`, after the `setApp(html)` call (the final call that sets page content), add:
```javascript
// Populate notification history asynchronously (non-blocking)
const notifEl = document.getElementById('notif-history');
if (notifEl) _renderNotifHistory(notifEl);
```

Also, find the HTML string that gets passed to `setApp()` in `renderHome()` and append a placeholder div at the very end of it, just before the closing string quote:
```html
<div id="notif-history" style="margin-top:8px"></div>
```

This ensures the notification section appears at the bottom of the home page below all existing content.

- [ ] **Step 5: Add all push-related functions to `index.html`**

Find the end of the `<script>` block in `index.html`. Add the following block before `</script>`:

```javascript
// ── Push notifications ───────────────────────────────────────────────────────

function _urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function _doSubscribe(registration, vapidKey) {
  try {
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(vapidKey),
    });
    await API.post('/push/subscribe', sub.toJSON());
  } catch (e) {
    console.warn('[push] subscribe failed:', e);
  }
}

async function initPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;
  try {
    const keyData = await API.get('/push/vapid-key');
    if (!keyData || !keyData.publicKey) return;
    const vapidKey = keyData.publicKey;
    const registration = await navigator.serviceWorker.ready;
    if (Notification.permission === 'granted') {
      await _doSubscribe(registration, vapidKey);
    } else if (!sessionStorage.getItem('push-banner-shown')) {
      sessionStorage.setItem('push-banner-shown', '1');
      const banner = document.createElement('div');
      banner.id = 'push-banner';
      banner.style.cssText = 'position:fixed;bottom:70px;left:0;right:0;background:#2563eb;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:999;font-size:14px;box-shadow:0 -2px 8px rgba(0,0,0,.15)';
      banner.innerHTML = `<span>${icS('alert')} Get notified when data is updated</span><div style="display:flex;gap:8px"><button style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer" onclick="(async(btn)=>{btn.disabled=true;const p=await Notification.requestPermission();if(p==='granted'){const r=await navigator.serviceWorker.ready;await _doSubscribe(r,'${vapidKey}');toast('Notifications enabled');}document.getElementById('push-banner')?.remove();})(this)">Enable</button><button style="background:rgba(0,0,0,.15);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer" onclick="document.getElementById('push-banner')?.remove()">Later</button></div>`;
      document.getElementById('app')?.append(banner);
    }
  } catch (e) {
    console.warn('[push] init failed:', e);
  }
}

function showSendNotification() {
  const u = S.user;
  if (!u) return;
  const isAdminOrDir = u.role === 'admin' || u.role === 'director';
  let opts = '';
  if (isAdminOrDir) {
    opts = `<option value="all">Everyone</option>
      <optgroup label="By Quad">
        <option value="quad:g79">Girls Yr 7–9</option>
        <option value="quad:b79">Boys Yr 7–9</option>
        <option value="quad:g1012">Girls Yr 10–12</option>
        <option value="quad:b1012">Boys Yr 10–12</option>
      </optgroup>
      <optgroup label="By Grade">
        <option value="grade:7:female">Grade 7 Girls</option><option value="grade:7:male">Grade 7 Boys</option>
        <option value="grade:8:female">Grade 8 Girls</option><option value="grade:8:male">Grade 8 Boys</option>
        <option value="grade:9:female">Grade 9 Girls</option><option value="grade:9:male">Grade 9 Boys</option>
        <option value="grade:10:female">Grade 10 Girls</option><option value="grade:10:male">Grade 10 Boys</option>
        <option value="grade:11:female">Grade 11 Girls</option><option value="grade:11:male">Grade 11 Boys</option>
        <option value="grade:12:female">Grade 12 Girls</option><option value="grade:12:male">Grade 12 Boys</option>
      </optgroup>`;
  } else {
    const q = u.quad || '';
    const isFemale = q.startsWith('g');
    const gLabel = isFemale ? 'Girls' : 'Boys';
    const gVal = isFemale ? 'female' : 'male';
    const bracket = q.endsWith('79') ? [7,8,9] : [10,11,12];
    opts = `<option value="quad:${q}">All ${gLabel} (my quad)</option>`;
    for (const g of bracket) opts += `<option value="grade:${g}:${gVal}">Grade ${g} ${gLabel}</option>`;
  }
  modal(`<h3 class="mt0">Send Notification</h3>
    <div id="push-send-err"></div>
    <div class="fg"><label class="fl">Send to</label><select class="fi" id="push-target">${opts}</select></div>
    <div class="fg"><label class="fl">Title</label><input class="fi" id="push-title" type="text" placeholder="Youth Ministry" maxlength="64"></div>
    <div class="fg"><label class="fl">Message</label><textarea class="fi" id="push-body" rows="3" placeholder="Write your notification..." maxlength="200"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="submitSendNotification()">Send</button>
    </div>`);
}

async function submitSendNotification() {
  const targetVal = document.getElementById('push-target')?.value;
  const title = document.getElementById('push-title')?.value?.trim() || 'Youth Ministry';
  const message = document.getElementById('push-body')?.value?.trim();
  const errEl = document.getElementById('push-send-err');
  if (!message) { if (errEl) errEl.innerHTML = '<div class="alert al-err">Message is required</div>'; return; }
  let target;
  if (targetVal === 'all') {
    target = { type: 'all' };
  } else if (targetVal?.startsWith('quad:')) {
    target = { type: 'quad', quad: targetVal.slice(5) };
  } else if (targetVal?.startsWith('grade:')) {
    const parts = targetVal.split(':');
    target = { type: 'grade', grade: parseInt(parts[1] ?? '7', 10), gender: parts[2] };
  } else {
    if (errEl) errEl.innerHTML = '<div class="alert al-err">Invalid target</div>';
    return;
  }
  try {
    const result = await API.post('/push/send', { target, title, message });
    closeModal();
    Cache.del('/push/notifications');
    toast(`Sent to ${result.sent} device${result.sent !== 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} failed)` : ''}`);
    const notifEl = document.getElementById('notif-history');
    if (notifEl) _renderNotifHistory(notifEl);
  } catch (e) {
    if (errEl) errEl.innerHTML = `<div class="alert al-err">${e.message}</div>`;
  }
}

// ── Notification history ─────────────────────────────────────────────────────

function _pushTargetLabel(target) {
  if (!target) return '';
  if (target.type === 'all') return 'Everyone';
  if (target.type === 'quad') {
    const labels = { g79: 'Girls Yr 7–9', b79: 'Boys Yr 7–9', g1012: 'Girls Yr 10–12', b1012: 'Boys Yr 10–12' };
    return labels[target.quad] || target.quad;
  }
  if (target.type === 'grade') return `Grade ${target.grade} ${target.gender === 'female' ? 'Girls' : 'Boys'}`;
  return '';
}

function _timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function _renderNotifHistory(el) {
  try {
    const data = await API.get('/push/notifications');
    const received = data.received || [];
    const sent = data.sent || [];
    if (received.length === 0 && sent.length === 0) { el.innerHTML = ''; return; }

    let html = '<div class="card" style="margin-top:4px"><div style="font-weight:600;margin-bottom:10px">Notification History</div>';

    if (received.length > 0) {
      if (sent.length > 0) html += '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted,#6b7280);margin-bottom:6px">Received</div>';
      for (const n of received) {
        html += `<div style="border-left:3px solid #e5e7eb;padding:8px 10px;margin-bottom:8px;background:var(--c-bg2,#f9fafb);border-radius:0 6px 6px 0">
          <div style="font-weight:500;font-size:14px">${n.title}</div>
          <div style="font-size:13px;color:var(--c-muted,#6b7280);margin:2px 0">${n.message}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font-size:12px;color:var(--c-muted,#6b7280)">From ${n.senderName} · ${_timeAgo(n.createdAt)}</span>
            <button class="btn" style="padding:3px 10px;font-size:12px" onclick="dismissNotification('${n.id}')">Dismiss</button>
          </div>
        </div>`;
      }
    }

    if (sent.length > 0) {
      html += `<div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted,#6b7280);margin-bottom:6px${received.length > 0 ? ';margin-top:12px' : ''}">Sent by me</div>`;
      for (const n of sent) {
        html += `<div style="border-left:3px solid #d1d5db;padding:8px 10px;margin-bottom:8px;background:var(--c-bg2,#f9fafb);border-radius:0 6px 6px 0">
          <div style="font-weight:500;font-size:14px">${n.title} <span style="font-size:11px;background:#e5e7eb;border-radius:4px;padding:1px 6px;font-weight:400">${_pushTargetLabel(n.target)}</span></div>
          <div style="font-size:13px;color:var(--c-muted,#6b7280);margin:2px 0">${n.message}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font-size:12px;color:var(--c-muted,#6b7280)">${_timeAgo(n.createdAt)} · reached ${n.sent} device${n.sent !== 1 ? 's' : ''}</span>
            <button class="btn" style="padding:3px 10px;font-size:12px;background:#fee2e2;color:#b91c1c;border-color:#fca5a5" onclick="deleteNotification('${n.id}')">Delete for all</button>
          </div>
        </div>`;
      }
    }

    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

async function dismissNotification(id) {
  try {
    await API.post(`/push/notifications/${id}/dismiss`, {});
    Cache.del('/push/notifications');
    const el = document.getElementById('notif-history');
    if (el) _renderNotifHistory(el);
  } catch (e) { toast(e.message); }
}

async function deleteNotification(id) {
  try {
    await API.del(`/push/notifications/${id}`);
    Cache.del('/push/notifications');
    const el = document.getElementById('notif-history');
    if (el) _renderNotifHistory(el);
  } catch (e) { toast(e.message); }
}
```

- [ ] **Step 6: Manual test checklist**

Start the server: `PERSISTENCE=memory npm run dev`

1. **Bell icon**: log in as admin → bell icon visible in header next to logout. Log in as a grade login → no bell icon.
2. **Send modal**: click bell → modal appears with "Send to / Title / Message" fields. Admin sees all target options including "Everyone" and grades. Quad login sees only their quad options.
3. **Send (memory mode)**: send a notification → toast confirms "Sent to 0 devices" (no push subscriptions in memory mode). History section appears at bottom of home page showing the sent notification in "Sent by me".
4. **Notification history**: received section appears only when there are received notifications. Empty → section is hidden.
5. **Dismiss**: click Dismiss on a received notification → it disappears from the list.
6. **Delete for all**: click "Delete for all" on a sent notification → it disappears from the list.
7. **Banner**: log in fresh with `VAPID_PUBLIC_KEY` set in `.env.local` → blue notification-enable banner appears at bottom of screen on first login.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: push UI — bell button, subscribe banner, send modal, notification history"
```

- [ ] **Step 8: Push and verify deploy**

```bash
git push origin master
```

Once live, full end-to-end test on mobile:
1. Open https://connection-made-simple.vercel.app → add to home screen
2. Log in → grant notification permission
3. From admin account → click bell → send a test notification
4. Verify the device receives the push and the home page history section shows it
5. Test Dismiss and "Delete for all" on the live app

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Admin/director: bell button to send | Task 7 (`_initShell` + `showSendNotification`) |
| Send to everyone / a quad / a gendered grade | Task 4 (`canActorSendTo` + `getUsersForTarget`) + Task 7 (modal options) |
| Quad leader: bell button scoped to their quad | Task 7 (role-aware modal options) |
| Quad leader: send to individual grade within their quad | Task 4 (`canActorSendTo` quad+grade check) + Task 7 |
| Notification history on home page | Task 7 (`_renderNotifHistory`, `notif-history` div) |
| Auto-expire after 3 days | Task 3 (`expiresAt` = now + 3d), Task 3 repo queries filter `expires_at > now()` |
| Manual dismiss | Task 4 (`dismissNotification` service method) + Task 7 (Dismiss button) |
| Admin/quad can see sent notifications | Task 4 (`findSentByUser`) + Task 7 (Sent by me section) |
| Sender can delete early (removes for all recipients) | Task 3 (`softDelete`), Task 4 (`deleteNotification` ForbiddenError guard) + Task 7 (Delete for all button) |
| PWA home-screen users receive push notifications | Task 6 (SW push handler) + Task 7 (subscription flow) |

### Placeholder scan

None. All code is complete in every step.

### Type consistency

- `PushTarget` defined in Task 2 (`push-subscription.ts`), imported by Task 3 (`notification.ts`), Task 4 (`push.service.ts`), Task 5 (controller), Task 7 (client) — consistent
- `Notification` + `NotificationWithRecipient` defined in Task 3, used in Tasks 4 and 5 — consistent
- `INotificationRepository` methods (`save`, `saveRecipients`, `findById`, `findSentByUser`, `findReceivedByUser`, `softDelete`, `dismissForUser`) defined in Task 3, implemented in Task 3 (Supabase + in-memory), called in Task 4 — consistent
- `makePushService` opts shape defined and used across Tasks 4 and 5 (`pushRepo`, `notifRepo`, `userRepo`) — consistent
- `req.params['id']` pattern matches how other controllers in the codebase read URL params — confirmed from existing code

### Notes for implementer

- **`generateId` in in-memory notification repo**: the file already imports `generateId` from `../../utils/id` for existing repos. Confirm this is the case before adding the notification repo class; if not, add the import.
- **`renderHome` HTML string**: the exact variable name holding the HTML string passed to `setApp()` varies. Search `grep -n "setApp" public/index.html` to find all call sites within `renderHome`, then add the `<div id="notif-history">` placeholder to the string that gets passed to the final `setApp()` call in that function.
- **`API.del`**: confirmed present in the SPA at line 1381 in the existing code.
- **`Cache.del`**: confirmed present in the SPA.
- **The `_prefetch()` call**: do NOT add `/push/notifications` to `_prefetch()` — it's user-specific and not worth pre-warming on every login.

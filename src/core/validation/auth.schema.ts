import { z } from 'zod';

export const LoginInputSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  // Optional device fingerprint for the admin Login Activity tab (see auth.service.ts).
  deviceId: z.string().min(1).max(64).optional(),
  deviceLabel: z.string().max(60).optional(),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

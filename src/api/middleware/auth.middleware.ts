import type { AuthService } from '../../services/auth.service';
import type { Actor } from '../../core/entities/user';

export async function resolveContext(
  authHeader: string | undefined,
  authService: AuthService,
  required: boolean,
): Promise<Actor | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return authService.resolveToken(token);
}

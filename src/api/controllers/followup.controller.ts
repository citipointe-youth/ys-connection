import type { AuthedRequest } from '../http/types';
import type { FollowupService } from '../../services/followup.service';

export function makeFollowupController(deps: { followup: FollowupService }) {
  return {
    async leaderFollowup(req: AuthedRequest) {
      return deps.followup.leaderFollowup(req.ctx, req.params['leaderId']!);
    },
  };
}

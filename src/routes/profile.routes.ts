import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { requireAuth } from '../middleware/auth';
import { profileDraftLimiter, profileIntakeLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/', requireAuth, ProfileController.getProfile);
router.post('/draft', requireAuth, profileDraftLimiter, ProfileController.generateDraft);
router.put('/', requireAuth, ProfileController.saveProfile);
// Two halves of one action: plan the questions, then structure the answers.
// Neither persists anything — the learner reviews the result and saves through
// PUT / above.
router.post('/intake/questions', requireAuth, profileIntakeLimiter, ProfileController.planIntake);
router.post('/intake/draft', requireAuth, profileIntakeLimiter, ProfileController.draftFromIntake);
router.post('/handoff', requireAuth, ProfileController.recordHandoff);

export default router;

import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { requireAuth } from '../middleware/auth';
import { profileDraftLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/', requireAuth, ProfileController.getProfile);
router.post('/draft', requireAuth, profileDraftLimiter, ProfileController.generateDraft);
router.put('/', requireAuth, ProfileController.saveProfile);
router.post('/handoff', requireAuth, ProfileController.recordHandoff);

export default router;

import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/status/:videoId', requireAuth, AIController.getStatus);
// Public quiz routes - no authentication required (matching video routes)
router.post('/quiz/generate', AIController.generateQuiz);
router.post('/quiz/validate', AIController.validateQuiz);

export default router;

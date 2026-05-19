import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/status/:videoId', requireAuth, AIController.getStatus);

export default router;

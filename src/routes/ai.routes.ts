import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Every route here can trigger a paid Gemini call, so all of them require a
// session. Leaving them public meant anonymous traffic could run up API spend,
// throttled only by the shared IP rate limiter. The UI already gates the quiz
// and chat pages behind login, so this costs nothing in UX.
router.get('/status/:videoId', requireAuth, AIController.getStatus);
router.post('/quiz/generate', requireAuth, AIController.generateQuiz);
router.post('/quiz/validate', requireAuth, AIController.validateQuiz);
router.post('/chat', requireAuth, AIController.chat);

export default router;

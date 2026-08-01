import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { requireAuth } from '../middleware/auth';
import { chatLimiter } from '../middleware/rateLimiter';

const router = Router();

// Every route here can trigger a paid Gemini call, so all of them require a
// session. Leaving them public meant anonymous traffic could run up API spend,
// throttled only by the shared IP rate limiter. The UI already gates the quiz
// and chat pages behind login, so this costs nothing in UX.
router.get('/status/:videoId', requireAuth, AIController.getStatus);
router.post('/quiz/generate', requireAuth, AIController.generateQuiz);
router.post('/quiz/validate', requireAuth, AIController.validateQuiz);
// Grounded chat ships a whole transcript per turn, so it gets its own
// per-user limit on top of the shared one.
router.get('/chat/thread', requireAuth, AIController.getChatThread);
router.delete('/chat/thread', requireAuth, AIController.clearChatThread);
router.post('/chat', requireAuth, chatLimiter, AIController.chat);

export default router;

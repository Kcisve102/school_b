import { Router } from 'express';
import { HistoryController } from '../controllers/history.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/watch', requireAuth, HistoryController.recordWatch);
router.post('/quiz-attempts', requireAuth, HistoryController.recordQuizAttempt);
router.get('/', requireAuth, HistoryController.getHistory);
router.get('/quiz-attempts/:attemptId', requireAuth, HistoryController.getQuizAttemptDetail);
router.post('/quiz-attempts/:attemptId/jobs', requireAuth, HistoryController.getJobSuggestions);
router.post('/quiz-attempts/:attemptId/jobs/more', requireAuth, HistoryController.findMoreJobs);

export default router;

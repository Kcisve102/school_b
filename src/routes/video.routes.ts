import { Router } from 'express';
import { VideoController } from '../controllers/video.controller';

const router = Router();

// Public routes - no authentication required
router.get('/', VideoController.getAll);
router.get('/category/:category', VideoController.getByCategory);
router.get('/:id', VideoController.getById);
router.get('/:id/transcript', VideoController.getTranscript);
router.get('/:id/summary', VideoController.getSummary);

export default router;

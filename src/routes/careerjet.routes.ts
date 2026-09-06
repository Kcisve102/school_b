import { Router } from 'express';
import { CareerjetController } from '../controllers/careerjet.controller';

const router = Router();

// Public: Careerjet has no per-learner account, so a learner can read real
// vacancies before signing up to anything.
router.get('/search', CareerjetController.searchJobs);

export default router;

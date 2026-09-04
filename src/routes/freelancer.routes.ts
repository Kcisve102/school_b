import { Router } from 'express';
import { FreelancerController } from '../controllers/freelancer.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/status', requireAuth, FreelancerController.getStatus);
router.get('/connect', requireAuth, FreelancerController.startAuth);
router.post('/disconnect', requireAuth, FreelancerController.disconnect);
router.get('/projects', requireAuth, FreelancerController.searchProjects);

// Public reads: browsing and reading jobs needs no Freelancer.com account, so
// a learner can explore work in their own language before signing up.
router.get('/browse', FreelancerController.searchProjectsPublic);
router.get('/recommended', requireAuth, FreelancerController.getRecommended);
router.get('/projects/:id', FreelancerController.getProject);

export default router;

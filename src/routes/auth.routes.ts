import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateRequest, signupSchema, loginSchema } from '../utils/validation';
import { authLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/signup', authLimiter, validateRequest(signupSchema), AuthController.signup);
router.post('/login', authLimiter, validateRequest(loginSchema), AuthController.login);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.getMe);
router.get('/check', AuthController.checkAuth);

export default router;

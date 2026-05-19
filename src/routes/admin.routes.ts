import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireAdmin } from '../middleware/adminAuth';
import { upload } from '../config/multer';
import { validateRequest, videoUploadSchema, videoLinkSchema, videoUpdateSchema } from '../utils/validation';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post(
  '/videos/upload',
  requireAdmin,
  uploadLimiter,
  upload.single('video'),
  validateRequest(videoUploadSchema),
  AdminController.uploadVideo
);

router.post(
  '/videos/upload-link',
  requireAdmin,
  uploadLimiter,
  validateRequest(videoLinkSchema),
  AdminController.uploadVideoLink
);

router.delete('/videos/:id', requireAdmin, AdminController.deleteVideo);
router.post('/videos/:id/re-render', requireAdmin, AdminController.reRenderTranscript);
router.put(
  '/videos/:id',
  requireAdmin,
  validateRequest(videoUpdateSchema),
  AdminController.updateVideo
);

router.get('/users', requireAdmin, AdminController.getUsers);
router.put('/users/:id/role', requireAdmin, AdminController.updateUserRole);
router.delete('/users/:id', requireAdmin, AdminController.deleteUser);

router.get('/stats', requireAdmin, AdminController.getStats);

export default router;

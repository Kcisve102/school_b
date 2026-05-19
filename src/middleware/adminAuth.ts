/// <reference path="../types/express-session.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';

export const requireAdmin = (req: Request, res: Response<ApiResponse>, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Please log in to access this resource',
    });
  }

  if (!req.session.isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }

  next();
};

export default requireAdmin;

import Joi from 'joi';

export const signupSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).required().messages({
    'string.min': 'Password must be at least 8 characters long',
    'any.required': 'Password is required',
  }),
  full_name: Joi.string().min(2).max(255).required().messages({
    'string.min': 'Full name must be at least 2 characters long',
    'string.max': 'Full name cannot exceed 255 characters',
    'any.required': 'Full name is required',
  }),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

export const videoUploadSchema = Joi.object({
  title: Joi.string().min(3).max(255).required().messages({
    'string.min': 'Title must be at least 3 characters long',
    'string.max': 'Title cannot exceed 255 characters',
    'any.required': 'Title is required',
  }),
  description: Joi.string().max(5000).allow('', null).optional(),
});

export const videoLinkSchema = Joi.object({
  title: Joi.string().min(3).max(255).required().messages({
    'string.min': 'Title must be at least 3 characters long',
    'string.max': 'Title cannot exceed 255 characters',
    'any.required': 'Title is required',
  }),
  description: Joi.string().max(5000).allow('', null).optional(),
  url: Joi.string().uri().required().messages({
    'string.uri': 'Please provide a valid URL',
    'any.required': 'Video URL is required',
  }),
});

export const videoUpdateSchema = Joi.object({
  title: Joi.string().min(3).max(255).optional().messages({
    'string.min': 'Title must be at least 3 characters long',
    'string.max': 'Title cannot exceed 255 characters',
  }),
  description: Joi.string().max(5000).allow('', null).optional(),
}).min(1).messages({
  'object.min': 'At least one field (title or description) must be provided',
});

export const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: any, res: any, next: any) => {
    const { error } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: errors,
      });
    }

    next();
  };
};

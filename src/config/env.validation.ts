import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('30d'),
  OTP_PEPPER: Joi.string().min(16).required(),
  GOOGLE_CLIENT_IDS: Joi.string().required(),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().email().required(),
  ADMIN_LOGIN_EMAIL: Joi.string().email(),
  ADMIN_LOGIN_PASSWORD: Joi.string().min(16).max(256),
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().allow(''),

  PAID_TOURNAMENTS_ENABLED: Joi.boolean().default(false),
  ROOM_RELEASE_MINUTES: Joi.number().default(15),
}).and('ADMIN_LOGIN_EMAIL', 'ADMIN_LOGIN_PASSWORD');

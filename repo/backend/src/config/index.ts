const DEFAULT_JWT_SECRET = 'talentops-jwt-secret-change-in-production';
const DEFAULT_ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

const isProduction = process.env.NODE_ENV === 'production';

// Fail-safe: refuse to start in production with default secrets
if (isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET must be set to a secure value in production. Do not use the default.');
  }
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
    throw new Error('FATAL: ENCRYPTION_KEY must be set to a secure value in production. Do not use the default.');
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'talentops',
    password: process.env.DB_PASSWORD || 'talentops_secret',
    database: process.env.DB_NAME || 'talentops',
  },
  jwt: {
    secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  encryption: {
    masterKey: process.env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY,
  },
  upload: {
    maxFileSize: 20 * 1024 * 1024, // 20MB for approval attachments
    attachmentMaxSize: 10 * 1024 * 1024, // 10MB for candidate attachments
    allowedExtensions: ['.pdf', '.docx'],
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },
  notification: {
    exportDir: process.env.NOTIFICATION_EXPORT_DIR || './exports/notifications',
  },
  resume: {
    maxVersions: 50,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

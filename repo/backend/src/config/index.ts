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
    secret: process.env.JWT_SECRET || 'talentops-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  encryption: {
    masterKey: process.env.ENCRYPTION_KEY || 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
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

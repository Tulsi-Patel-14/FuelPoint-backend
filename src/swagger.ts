import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Petrol Pump Backend API',
    version: '1.0.0',
    description: 'API documentation for Customer, Worker, and Admin clients.'
  },
  paths: {
    '/api/v1/admin/auth/forgot-password': {
      post: {
        summary: 'Request password reset link',
        tags: ['Admin Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    example: 'admin@fuelpoint.in'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Reset request received (generic message to prevent email enumeration)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'If an account exists for this email, a password reset link has been sent.'
                    }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid input'
          },
          429: {
            description: 'Too many reset requests'
          }
        }
      }
    },
    '/api/v1/admin/auth/reset-password': {
      post: {
        summary: 'Reset password with secure token',
        tags: ['Admin Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: {
                    type: 'string',
                    example: 'e83a7f9...'
                  },
                  password: {
                    type: 'string',
                    minLength: 8,
                    example: 'NewSecurePassword123!'
                  },
                  confirmPassword: {
                    type: 'string',
                    example: 'NewSecurePassword123!'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Password reset successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Password reset successfully.'
                    }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid or expired token, or invalid password'
          }
        }
      }
    }
  }
};

export const setupSwagger = (app: Express) => {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};


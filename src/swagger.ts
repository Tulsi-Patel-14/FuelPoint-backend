import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Petrol Pump Backend API',
    version: '1.0.0',
    description: 'API documentation for Customer, Worker, and Admin clients.'
  },
  paths: {}
};

export const setupSwagger = (app: Express) => {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};


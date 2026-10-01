import swaggerUi from 'swagger-ui-express';
const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'Petrol Pump Backend API',
        version: '1.0.0',
        description: 'API documentation for Customer, Worker, and Admin clients.'
    },
    servers: [
        { url: '/api/v1', description: 'Local V1' }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            }
        }
    },
    security: [
        { bearerAuth: [] }
    ],
    paths: {
        '/customer/auth/login': {
            post: {
                tags: ['Customer'],
                summary: 'Login customer',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { mobile: { type: 'string' }, otp: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Success' } }
            }
        },
        '/customer/qr/generate': {
            post: {
                tags: ['Customer'],
                summary: 'Generate QR for fueling',
                responses: { 200: { description: 'Success' } }
            }
        },
        '/worker/auth/login': {
            post: {
                tags: ['Worker'],
                summary: 'Login worker',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { identifier: { type: 'string' }, password: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Success' } }
            }
        },
        '/worker/qr/validate': {
            post: {
                tags: ['Worker'],
                summary: 'Validate scanned QR',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { qrToken: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Success' } }
            }
        },
        '/worker/transactions/redeem': {
            post: {
                tags: ['Worker'],
                summary: 'Redeem fuel transaction',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { qrSessionId: { type: 'string' }, customerId: { type: 'string' }, fuelAmount: { type: 'number' }, idempotencyKey: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Success' } }
            }
        },
        '/admin/auth/login': {
            post: {
                tags: ['Admin'],
                summary: 'Login admin',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Success' } }
            }
        },
        '/admin/dashboard': {
            get: { tags: ['Admin'], summary: 'Admin Dashboard Stats', responses: { 200: { description: 'Success' } } }
        },
        '/admin/customers': {
            get: { tags: ['Admin'], summary: 'List Customers', responses: { 200: { description: 'Success' } } }
        }
    }
};
export const setupSwagger = (app) => {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};

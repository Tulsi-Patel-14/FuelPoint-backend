import 'dotenv/config';
import app from './app';
import prisma from './utils/prisma';
import { backfillCustomIds } from './utils/idGenerator';

const PORT = process.env.PORT || 5000;

// Automatically backfill any missing custom IDs in DB on launch
backfillCustomIds(prisma).then(() => {
  console.log('✅ Auto customId sync verified in database.');
}).catch(err => {
  console.error('Failed to run custom ID backfill:', err);
});

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT} (all interfaces)`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});

// Graceful shutdown so tsx watch can restart without EADDRINUSE
const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT || 5000;

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


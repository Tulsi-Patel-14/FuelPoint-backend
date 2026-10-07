import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT || 5000;

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT} (all interfaces)`);
});

server.on('error', (error) => {
  console.error('Server failed to start:', error);
});


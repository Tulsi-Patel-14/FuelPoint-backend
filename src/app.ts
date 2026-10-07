import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes';
import { errorHandler } from './middlewares/error.middleware';
import { notFoundHandler } from './middlewares/notFound.middleware';
import { setupSwagger } from './swagger';

const app = express();

setupSwagger(app);

import path from 'path';

app.use(helmet({
  crossOriginResourcePolicy: false, // allow serving images cross-origin
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(process.cwd(), 'public/uploads')));

// Custom middleware to log incoming API calls and their data
app.use((req, res, next) => {
  console.log(`\n[API CALL] ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('-> Body Data:', JSON.stringify(req.body, null, 2));
  }
  if (req.query && Object.keys(req.query).length > 0) {
    console.log('-> Query Data:', JSON.stringify(req.query, null, 2));
  }
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Backend is healthy' });
});

import router from './routes/index';

app.use('/api/v1', router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;


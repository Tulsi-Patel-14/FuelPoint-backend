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

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Backend is healthy' });
});

import router from './routes/index';

app.use('/api/v1', router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;


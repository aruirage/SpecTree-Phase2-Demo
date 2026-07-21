import cors from 'cors';
import express from 'express';
import clauseCompareRouter from './routes/clauseCompare.js';
import jobsRouter from './routes/jobs.js';
import licenseRouter from './routes/license.js';
import logsRouter from './routes/logs.js';
import specTreeRouter from './routes/specTree.js';
import systemRouter from './routes/system.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'phase2-demo-mock-backend',
    port: Number(process.env.PORT || 3002),
  });
});

app.use('/api/spec-tree', specTreeRouter);
app.use('/api/clause-compare', clauseCompareRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/license', licenseRouter);
app.use('/api/logs', logsRouter);
app.use('/api/system', systemRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

export default app;

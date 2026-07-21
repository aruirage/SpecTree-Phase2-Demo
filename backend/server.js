import cors from 'cors';
import express from 'express';
import clauseCompareRouter from './src/routes/clauseCompare.js';
import jobsRouter from './src/routes/jobs.js';
import licenseRouter from './src/routes/license.js';
import logsRouter from './src/routes/logs.js';
import specTreeRouter from './src/routes/specTree.js';
import systemRouter from './src/routes/system.js';

const PORT = Number(process.env.PORT || 3002);
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'phase2-demo-mock-backend', port: PORT });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Phase2 mock backend listening on http://0.0.0.0:${PORT}`);
});

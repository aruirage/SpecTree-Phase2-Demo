import app from './src/app.js';

const PORT = Number(process.env.PORT || 3002);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Phase2 mock backend listening on http://0.0.0.0:${PORT}`);
});

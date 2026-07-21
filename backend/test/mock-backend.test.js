import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import test from 'node:test';
import ExcelJS from 'exceljs';

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForHealth(baseUrl, getOutput) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`backend did not become healthy\n${getOutput()}`);
}

function createPdfFile(name) {
  return new File([new Blob(['%PDF-1.4 mock'])], name, { type: 'application/pdf' });
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  assert.equal(res.ok, true, JSON.stringify(data));
  return data;
}

async function pollJson(url, predicate, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (predicate(data)) return data;
    } else {
      assert.equal(res.status, 202);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function startBackend(t) {
  const port = await getAvailablePort();
  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  t.after(() => {
    child.kill('SIGTERM');
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, () => output.join(''));
  return baseUrl;
}

test('mock backend supports spec tree and clause compare demo flows', async (t) => {
  const baseUrl = await startBackend(t);

  const specUploadForm = new FormData();
  specUploadForm.append('files', createPdfFile('M000378.pdf'));
  const specUpload = await readJson(await fetch(`${baseUrl}/api/spec-tree/upload`, {
    method: 'POST',
    body: specUploadForm,
  }));
  assert.match(specUpload.sessionId, /^st-/);
  assert.equal(specUpload.files.length, 1);

  const specStart = await fetch(`${baseUrl}/api/spec-tree/generate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: specUpload.sessionId,
      rootFileIds: [specUpload.files[0].id],
      clientRunId: 'test-spec-run',
    }),
  });
  assert.equal(specStart.status, 202);
  const specStartPayload = await specStart.json();
  assert.equal(specStartPayload.jobs.length, 1);

  const specResult = await pollJson(
    `${baseUrl}/api/spec-tree/result?sessionId=${encodeURIComponent(specStartPayload.jobs[0].sessionId)}`,
    (data) => Boolean(data.mmdContent),
  );
  assert.equal(specResult.nodeCount, 4);

  const oldForm = new FormData();
  oldForm.append('file', createPdfFile('AMS2750E.pdf'));
  oldForm.append('fileType', 'old');
  const oldUpload = await readJson(await fetch(`${baseUrl}/api/clause-compare/upload`, {
    method: 'POST',
    body: oldForm,
  }));

  const newForm = new FormData();
  newForm.append('file', createPdfFile('AMS2750F.pdf'));
  newForm.append('fileType', 'new');
  newForm.append('sessionId', oldUpload.sessionId);
  const newUpload = await readJson(await fetch(`${baseUrl}/api/clause-compare/upload`, {
    method: 'POST',
    body: newForm,
  }));
  assert.equal(newUpload.sessionId, oldUpload.sessionId);

  const compareStart = await fetch(`${baseUrl}/api/clause-compare/run/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: oldUpload.sessionId, clientRunId: 'test-clause-run' }),
  });
  assert.equal(compareStart.status, 202);

  const clauseResult = await pollJson(
    `${baseUrl}/api/clause-compare/result?sessionId=${encodeURIComponent(oldUpload.sessionId)}`,
    (data) => Array.isArray(data.clauses),
  );
  assert.equal(clauseResult.totalClauses, 6);
});

test('prompt setup is not exposed in phase 2 demo logs or API', async (t) => {
  const baseUrl = await startBackend(t);

  const promptRes = await fetch(`${baseUrl}/api/prompts`);
  assert.equal(promptRes.status, 404);

  const logs = await readJson(await fetch(`${baseUrl}/api/logs/list`));
  assert.equal(
    logs.events.some((event) => event.actionType === 'プロンプト変更'),
    false,
  );
});

test('job cancel stops the backing mock session', async (t) => {
  const baseUrl = await startBackend(t);

  const specUploadForm = new FormData();
  specUploadForm.append('files', createPdfFile('M000501.pdf'));
  const specUpload = await readJson(await fetch(`${baseUrl}/api/spec-tree/upload`, {
    method: 'POST',
    body: specUploadForm,
  }));

  const specStart = await readJson(await fetch(`${baseUrl}/api/spec-tree/generate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: specUpload.sessionId,
      rootFileIds: [specUpload.files[0].id],
    }),
  }));
  const job = specStart.jobs[0];

  const cancelled = await readJson(await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(job.jobId)}/cancel`, {
    method: 'POST',
  }));
  assert.equal(cancelled.status, 'cancelled');

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const jobAfter = await readJson(await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(job.jobId)}`));
  assert.equal(jobAfter.status, 'cancelled');

  const resultAfter = await fetch(`${baseUrl}/api/spec-tree/result?sessionId=${encodeURIComponent(job.sessionId)}`);
  assert.equal(resultAfter.status, 404);
  const body = await resultAfter.json();
  assert.equal(body.code, 499);
});

test('clause compare excel export keeps report diff styling', async (t) => {
  const baseUrl = await startBackend(t);

  const oldForm = new FormData();
  oldForm.append('file', createPdfFile('AMS2750E.pdf'));
  oldForm.append('fileType', 'old');
  const oldUpload = await readJson(await fetch(`${baseUrl}/api/clause-compare/upload`, {
    method: 'POST',
    body: oldForm,
  }));

  const newForm = new FormData();
  newForm.append('file', createPdfFile('AMS2750F.pdf'));
  newForm.append('fileType', 'new');
  newForm.append('sessionId', oldUpload.sessionId);
  await readJson(await fetch(`${baseUrl}/api/clause-compare/upload`, {
    method: 'POST',
    body: newForm,
  }));

  await readJson(await fetch(`${baseUrl}/api/clause-compare/run/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: oldUpload.sessionId }),
  }));
  await pollJson(
    `${baseUrl}/api/clause-compare/result?sessionId=${encodeURIComponent(oldUpload.sessionId)}`,
    (data) => Array.isArray(data.clauses),
  );

  const exportRes = await fetch(`${baseUrl}/api/clause-compare/export?format=excel&sessionId=${encodeURIComponent(oldUpload.sessionId)}`);
  assert.equal(exportRes.status, 200);
  assert.match(
    exportRes.headers.get('content-type') || '',
    /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportRes.arrayBuffer());
  const sheet = workbook.getWorksheet('条項比較');
  assert.ok(sheet);

  const deletedRow = sheet.getRow(7);
  assert.equal(deletedRow.getCell(9).value, '削除');
  assert.equal(deletedRow.getCell(2).font.strike, true);
  assert.equal(deletedRow.getCell(2).font.color.argb, 'FFDC2626');
  assert.equal(deletedRow.getCell(2).fill.fgColor.argb, 'FFE5E7EB');

  const addedRow = sheet.getRow(8);
  assert.equal(addedRow.getCell(9).value, '追加');
  assert.equal(addedRow.getCell(6).font.color.argb, 'FF0076BF');
  assert.equal(addedRow.getCell(6).fill.fgColor.argb, 'FFDCFCE7');
});

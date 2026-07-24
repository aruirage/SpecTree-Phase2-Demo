import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

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

test('license exports a separate encrypted settlement counter file', async (t) => {
  const baseUrl = await startBackend(t);

  const exportRes = await fetch(`${baseUrl}/api/license/settlement-counter/export`);
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.headers.get('content-type'), 'application/octet-stream');
  assert.match(
    exportRes.headers.get('content-disposition') || '',
    /settlement_counter_TOKYO-01_\d{12}\.enc/,
  );

  const envelope = JSON.parse(Buffer.from(await exportRes.arrayBuffer()).toString('utf-8'));
  assert.equal(envelope.algorithm, 'MOCK-AES256-GCM+SHA256');
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf-8'));
  assert.equal(payload.fileType, 'settlement_counter');
  assert.equal(payload.billingMetric, 'total_pages');
  assert.equal(payload.siteCode, 'TOKYO-01');
  assert.equal(typeof payload.chainHead, 'string');
  assert.equal(payload.summary.totalPages > 0, true);
});

test('clause compare excel export keeps row styling separate from field diff styling', async (t) => {
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
  assert.match(exportRes.headers.get('content-disposition') || '', /comp_AMS2750F_\d{12}\.xlsx/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportRes.arrayBuffer());
  const sheet = workbook.getWorksheet('条項比較');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, '【旧】REV');
  assert.equal(sheet.getCell('A1').font.name, 'Noto Sans JP');
  assert.equal(sheet.getCell('D1').value, '【新】REV');
  assert.equal(sheet.getCell('G1').value, '比較区分');
  assert.equal(sheet.getCell('A2').value, '項');
  assert.equal(sheet.getCell('A2').font.name, 'Noto Sans JP');
  assert.equal(sheet.getCell('B2').value, '記載内容');
  assert.equal(sheet.getCell('C2').value, '日本語訳（参考）');
  assert.equal(sheet.getCell('D2').value, '項');
  assert.equal(sheet.getCell('E2').value, '記載内容');
  assert.equal(sheet.getCell('F2').value, '日本語訳（参考）');

  const deletedRow = sheet.getRow(7);
  assert.equal(deletedRow.getCell(7).value, '削除');
  assert.equal(deletedRow.getCell(2).font.strike, undefined);
  assert.equal(deletedRow.getCell(2).font.color.argb, 'FF334155');
  assert.equal(deletedRow.getCell(2).fill.fgColor.argb, 'FFE5E7EB');

  const addedRow = sheet.getRow(8);
  assert.equal(addedRow.getCell(7).value, '追加');
  assert.equal(addedRow.getCell(5).font.color.argb, 'FF334155');
  assert.equal(addedRow.getCell(5).fill.fgColor.argb, 'FFE6F6D8');

  const changedRow = sheet.getRow(3);
  assert.equal(changedRow.getCell(7).value, '変更');
  assert.equal(changedRow.getCell(2).font.name, 'Noto Sans JP');
  assert.equal(changedRow.getCell(2).font.color.argb, 'FF334155');
  assert.equal(changedRow.getCell(5).font.name, 'Noto Sans JP');
  assert.equal(changedRow.getCell(5).font.color.argb, 'FF334155');
  const oldRichText = changedRow.getCell(2).value.richText;
  const newRichText = changedRow.getCell(5).value.richText;
  assert.equal(Array.isArray(oldRichText), true);
  assert.equal(Array.isArray(newRichText), true);
  assert.equal(oldRichText[0].text, 'Furnace temperature uniformity shall be verified per Table 1.');
  assert.equal(oldRichText[0].font.color.argb, 'FF334155');
  assert.equal(oldRichText.some((part) => part.font.strike === true), false);
  assert.equal(newRichText[0].text.trimEnd(), 'Furnace temperature uniformity shall be verified per Table 1');
  assert.equal(newRichText[0].font.color.argb, 'FF334155');
  const addedText = newRichText
    .filter((part) => part.font.color.argb === 'FF0076BF')
    .map((part) => part.text)
    .join(' ');
  assert.match(addedText, /and/);
  assert.match(addedText, /Table/);
  assert.match(addedText, /1A/);
  const oldTranslationRichText = changedRow.getCell(3).value.richText;
  const newTranslationRichText = changedRow.getCell(6).value.richText;
  assert.equal(Array.isArray(oldTranslationRichText), true);
  assert.equal(Array.isArray(newTranslationRichText), true);
  assert.match(oldTranslationRichText.map((part) => part.text).join(''), /炉温/);
  assert.match(newTranslationRichText.map((part) => part.text).join(''), /表1A/);

  const imageZipRes = await fetch(`${baseUrl}/api/clause-compare/images/export?sessionId=${encodeURIComponent(oldUpload.sessionId)}`);
  assert.equal(imageZipRes.status, 200);
  assert.match(imageZipRes.headers.get('content-disposition') || '', /comp_AMS2750F_\d{12}\.zip/);
  const zip = await JSZip.loadAsync(await imageZipRes.arrayBuffer());
  assert.ok(zip.file('new/Images/新 画像1.png'));
  assert.ok(zip.file('old/Images/旧 画像1.png'));
});

test('completed clause compare history jobs always have downloadable exports', async (t) => {
  const baseUrl = await startBackend(t);

  await new Promise((resolve) => setTimeout(resolve, 3600));
  const history = await readJson(await fetch(`${baseUrl}/api/jobs?type=clause_compare&scope=history`));
  const completedJobs = history.jobs.filter((job) => job.status === 'completed');
  assert.equal(completedJobs.length > 0, true);

  for (const job of completedJobs) {
    const excelRes = await fetch(`${baseUrl}/api/clause-compare/export?format=excel&sessionId=${encodeURIComponent(job.sessionId)}`);
    assert.equal(excelRes.status, 200, `${job.id} excel export should be downloadable`);

    const imageZipRes = await fetch(`${baseUrl}/api/clause-compare/images/export?sessionId=${encodeURIComponent(job.sessionId)}`);
    assert.equal(imageZipRes.status, 200, `${job.id} image export should be downloadable`);
  }
});

test('spec tree upload preserves Japanese filenames and exports Excel layout', async (t) => {
  const baseUrl = await startBackend(t);

  const form = new FormData();
  form.append('files', createPdfFile('日本語_規格-Rev.C（確認用）.pdf'));
  form.append('files', createPdfFile('別Root_対象.pdf'));
  const upload = await readJson(await fetch(`${baseUrl}/api/spec-tree/upload`, {
    method: 'POST',
    body: form,
  }));
  assert.equal(upload.files[0].name, '日本語_規格-Rev.C（確認用）.pdf');
  assert.equal(upload.files[1].name, '別Root_対象.pdf');

  const start = await readJson(await fetch(`${baseUrl}/api/spec-tree/generate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: upload.sessionId,
      rootFileIds: [upload.files[1].id],
    }),
  }));

  await pollJson(
    `${baseUrl}/api/spec-tree/result?sessionId=${encodeURIComponent(start.jobs[0].sessionId)}`,
    (data) => Boolean(data.mmdContent),
  );

  const exportRes = await fetch(`${baseUrl}/api/spec-tree/export?format=excel&sessionId=${encodeURIComponent(start.jobs[0].sessionId)}`);
  assert.equal(exportRes.status, 200);
  assert.match(
    exportRes.headers.get('content-type') || '',
    /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );
  assert.match(exportRes.headers.get('content-disposition') || '', /st_.*Root.*_\d{12}\.xlsx/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportRes.arrayBuffer());
  const sheet = workbook.getWorksheet('スペックツリー');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'スペックNo');
  assert.equal(sheet.getCell('A1').font.name, 'Noto Sans JP');
  assert.equal(sheet.getCell('B1').value, '階層');
  assert.equal(sheet.getCell('C1').value, 'スペック名称');
  assert.equal(sheet.getCell('D1').value, '改訂記号');
  assert.equal(sheet.getRow(2).getCell(1).font.name, 'Noto Sans JP');
  assert.equal(sheet.getRow(4).getCell(1).alignment.indent, 2);
});

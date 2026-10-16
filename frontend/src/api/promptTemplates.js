const API_BASE = '/api/prompt-templates';

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.rejected = data.rejected || [];
    throw error;
  }
  return data;
}

export async function fetchPromptTemplates() {
  return parseResponse(await fetch(API_BASE, { cache: 'no-store' }));
}

export async function updatePromptTemplate(id, payload) {
  return parseResponse(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function createPromptTemplate(payload = {}) {
  return parseResponse(await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function deletePromptTemplate(id) {
  return parseResponse(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function resetPromptTemplate(id) {
  return parseResponse(await fetch(`${API_BASE}/${encodeURIComponent(id)}/reset`, { method: 'POST' }));
}

export async function analyzePromptTemplate(id, payload = {}) {
  return parseResponse(await fetch(`${API_BASE}/${encodeURIComponent(id)}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function testPromptTemplate(id, file, promptType = 'clause_compare', promptOverride = '') {
  const body = new FormData();
  body.append('file', file);
  body.append('promptType', promptType);
  if (promptOverride) body.append('promptOverride', promptOverride);
  return parseResponse(await fetch(`${API_BASE}/${encodeURIComponent(id)}/test`, { method: 'POST', body }));
}

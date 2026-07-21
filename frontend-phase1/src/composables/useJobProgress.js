import { ref } from 'vue';

export function useJobProgress({
  progressUrl,
  stages,
  initialStage = 'submitting',
  fallbackLabel,
  pollMs = 1200,
  smoothPageSummary = false,
  pageSmoothStep = 1,
}) {
  const progress = ref(0);
  const label = ref(fallbackLabel);
  const progressSummary = ref('');
  let target = 0;
  let cap = 95;
  let pageTotalState = 0;
  let pageTargetCompleted = 0;
  let pageDisplayedCompleted = 0;
  let pdfTotalState = 0;
  let pdfCompletedState = 0;
  let pollTimer = null;
  let tickTimer = null;
  let runToken = 0;
  let polling = false;

  function updateProgressSummary() {
    if (pageTotalState > 0) {
      progressSummary.value = pageDisplayedCompleted > 0
        ? `処理済みページ ${pageDisplayedCompleted} / ${pageTotalState}`
        : `処理対象ページ ${pageTotalState}`;
      return;
    }
    progressSummary.value = pdfTotalState > 0 ? `処理済みPDF ${pdfCompletedState} / ${pdfTotalState}` : '';
  }

  function applyState(state) {
    const stage = state.stage;
    const config = stages[stage] || stages.running;
    if (!config) return;
    const requestTotal = Math.max(0, Number(state.requestTotal || 0));
    const requestCompleted = Math.min(requestTotal, Math.max(0, Number(state.requestCompleted || 0)));
    pdfTotalState = Math.max(0, Number(state.pdfTotal || 0));
    pdfCompletedState = Math.min(pdfTotalState, Math.max(0, Number(state.pdfCompleted || 0)));
    const pageTotal = Math.max(0, Number(state.pageTotal || 0));
    const pageCompleted = Math.min(pageTotal, Math.max(0, Number(state.pageCompleted || 0)));
    pageTotalState = pageTotal;
    pageTargetCompleted = Math.max(pageTargetCompleted, pageCompleted);
    if (!smoothPageSummary) {
      pageDisplayedCompleted = pageTargetCompleted;
    } else if (pageDisplayedCompleted > pageTargetCompleted) {
      pageDisplayedCompleted = pageTargetCompleted;
    }
    updateProgressSummary();
    if (config.requestDriven) {
      if (requestTotal > 0) {
        const ratio = requestCompleted / requestTotal;
        const requestCap = Math.max(config.value, config.cap - 2);
        const requestTarget = Math.floor(config.value + ((requestCap - config.value) * ratio));
        target = Math.max(target, requestTarget);
        cap = target;
      } else {
        target = Math.max(target, config.value);
        cap = target;
      }
    } else {
      target = Math.max(target, config.value);
      cap = Math.max(target, config.cap);
    }
    label.value = config.label || fallbackLabel;
  }

  function tick() {
    if (progress.value < target) {
      progress.value = Math.min(target, progress.value + Math.max(1, Math.ceil((target - progress.value) / 3)));
    } else if (progress.value < cap) {
      progress.value += 1;
    }
    if (smoothPageSummary && pageDisplayedCompleted < pageTargetCompleted) {
      const step = Math.max(1, Number(pageSmoothStep) || 1);
      pageDisplayedCompleted = Math.min(pageTargetCompleted, pageDisplayedCompleted + step);
      updateProgressSummary();
    }
  }

  async function poll(sessionId, token) {
    if (!sessionId || token !== runToken || polling) return;
    polling = true;
    try {
      const res = await fetch(`${progressUrl}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!res.ok || token !== runToken) return;
      const state = await res.json();
      if (state.running) applyState(state);
    } catch {
      // The main request owns error reporting; progress polling is best-effort.
    } finally {
      polling = false;
    }
  }

  function start(sessionId) {
    stop();
    const token = ++runToken;
    progress.value = 2;
    target = 2;
    cap = 8;
    pageTotalState = 0;
    pageTargetCompleted = 0;
    pageDisplayedCompleted = 0;
    pdfTotalState = 0;
    pdfCompletedState = 0;
    label.value = fallbackLabel;
    applyState({ stage: initialStage });
    tickTimer = setInterval(tick, 700);
    pollTimer = setInterval(() => poll(sessionId, token), Math.max(250, Number(pollMs) || 1200));
    setTimeout(() => poll(sessionId, token), 500);
  }

  function complete() {
    clearTimers();
    progress.value = 100;
    target = 100;
    cap = 100;
    pageDisplayedCompleted = pageTargetCompleted;
    updateProgressSummary();
  }

  function stop({ reset = false } = {}) {
    runToken += 1;
    clearTimers();
    if (reset) {
      progress.value = 0;
      target = 0;
      cap = 95;
      pageTotalState = 0;
      pageTargetCompleted = 0;
      pageDisplayedCompleted = 0;
      pdfTotalState = 0;
      pdfCompletedState = 0;
      label.value = fallbackLabel;
      progressSummary.value = '';
    }
  }

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    pollTimer = null;
    tickTimer = null;
    polling = false;
  }

  return { progress, label, progressSummary, start, complete, stop };
}

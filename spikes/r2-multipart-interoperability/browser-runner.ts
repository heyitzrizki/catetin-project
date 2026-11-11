/**
 * Real Browser CORS Runner for Phase R3B-A:
 * Cloudflare R2 Multipart Interoperability Spike.
 *
 * Exercises real browser CORS preflight and response header exposure:
 * 1. Calls Worker /spike/multipart/initiate with Authorization: Bearer <token>.
 * 2. Generates deterministic 18 MiB payload (8 MiB + 8 MiB + 2 MiB).
 * 3. Sends 3 direct PUT requests from browser fetch to presigned R2 URLs.
 * 4. Reads response.headers.get("ETag") and fails explicitly with
 *    CORS_ETAG_NOT_EXPOSED if ETag is hidden by browser CORS.
 * 5. Calls Worker /spike/multipart/complete.
 * 6. Calls Worker /spike/multipart/head and asserts size === 18,874,368 bytes.
 * 7. Runs deterministic cleanup in finally.
 */

import {
  SPIKE_TOTAL_SIZE_BYTES,
  type SpikeRunReport,
} from './protocol.ts';
import {
  createDeterministic18MiBPayload,
  createHttpSpikeControlPlane,
  createSanitizedSpikeLogger,
  runMultipartInteroperabilitySpike,
} from './runner.ts';

export interface BrowserSpikeRunOptions {
  workerBaseUrl: string;
  controlToken: string;
  fetchImpl?: typeof fetch;
}

export async function runBrowserMultipartCorsSpike(
  options: BrowserSpikeRunOptions
): Promise<SpikeRunReport> {
  const logger = createSanitizedSpikeLogger();
  const payload = createDeterministic18MiBPayload(SPIKE_TOTAL_SIZE_BYTES);
  const controlPlane = createHttpSpikeControlPlane({
    workerBaseUrl: options.workerBaseUrl,
    controlToken: options.controlToken,
    fetchImpl: options.fetchImpl,
  });

  return runMultipartInteroperabilitySpike(controlPlane, {
    payload,
    logger,
    strictCorsEtagErrorCategory: true,
  });
}

function initBrowserDomHarness(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const workerUrlInput = document.getElementById('worker-base-url') as HTMLInputElement | null;
  const tokenInput = document.getElementById('spike-control-token') as HTMLInputElement | null;
  const runButton = document.getElementById('run-spike-btn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('spike-status') as HTMLElement | null;
  const outputEl = document.getElementById('spike-report-output') as HTMLElement | null;

  if (!workerUrlInput || !tokenInput || !runButton || !statusEl || !outputEl) {
    return;
  }

  runButton.addEventListener('click', async () => {
    const workerBaseUrl = workerUrlInput.value.trim();
    const controlToken = tokenInput.value.trim();

    if (!workerBaseUrl || !controlToken) {
      statusEl.textContent = 'STATUS: ERROR (Missing Worker URL or Control Token)';
      return;
    }

    runButton.disabled = true;
    statusEl.textContent = 'STATUS: RUNNING (Uploading 18 MiB in 3 parts: 8+8+2 MiB)...';
    outputEl.textContent = '';

    try {
      const report = await runBrowserMultipartCorsSpike({
        workerBaseUrl,
        controlToken,
      });

      // Clear token input from DOM after execution for hygiene
      tokenInput.value = '';

      statusEl.textContent = report.succeeded
        ? 'STATUS: PASS (18,874,368 bytes verified & cleaned up)'
        : `STATUS: FAIL (${report.failureCategory ?? 'UNKNOWN'})`;
      outputEl.textContent = JSON.stringify(report, null, 2);
    } catch {
      statusEl.textContent = 'STATUS: FAIL (UNEXPECTED_RUNNER_ERROR)';
    } finally {
      runButton.disabled = false;
    }
  });
}

initBrowserDomHarness();

import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceWorkerUpdateCoordinator } from '../../src/pwa/update-coordinator';

function waitingWorker() {
  const messages: unknown[] = [];
  return { messages, worker: { postMessage: (message: unknown) => messages.push(message) } };
}

test('keeps an update waiting while transcription is active', () => {
  const target = waitingWorker();
  const coordinator = new ServiceWorkerUpdateCoordinator();
  coordinator.setJobActive(true);
  coordinator.noteWaiting(target.worker);
  assert.deepEqual(target.messages, []);
  coordinator.setJobActive(false);
  assert.deepEqual(target.messages, [{ type: 'CATETIN_ACTIVATE_UPDATE' }]);
});

test('activates a waiting update immediately when no job is active', () => {
  const target = waitingWorker();
  const coordinator = new ServiceWorkerUpdateCoordinator();
  coordinator.noteWaiting(target.worker);
  coordinator.setJobActive(false);
  assert.deepEqual(target.messages, [{ type: 'CATETIN_ACTIVATE_UPDATE' }]);
});

interface WaitingWorker {
  postMessage(message: { type: 'CATETIN_ACTIVATE_UPDATE' }): void;
}

export class ServiceWorkerUpdateCoordinator {
  private activeJob = false;
  private waiting: WaitingWorker | null = null;

  setJobActive(active: boolean) {
    this.activeJob = active;
    this.activateWhenSafe();
  }

  noteWaiting(worker: WaitingWorker) {
    this.waiting = worker;
    this.activateWhenSafe();
  }

  private activateWhenSafe() {
    if (this.activeJob || !this.waiting) return;
    this.waiting.postMessage({ type: 'CATETIN_ACTIVATE_UPDATE' });
    this.waiting = null;
  }
}

const coordinator = new ServiceWorkerUpdateCoordinator();

export function setTranscriptionJobActive(active: boolean) {
  coordinator.setJobActive(active);
}

export async function registerServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('/sw.js', { type: 'module' });
  if (registration.waiting) coordinator.noteWaiting(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        coordinator.noteWaiting(registration.waiting ?? installing);
      }
    });
  });
}

// FIFO per chatId. Prevents silent failures when scheduled tasks and live
// conversation race. One message in flight per chat at a time.

type Job<T> = () => Promise<T>;

export class PerChatQueue {
  private queues = new Map<string, Promise<unknown>>();

  enqueue<T>(chatId: string | number, job: Job<T>): Promise<T> {
    const key = String(chatId);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(job, job); // run job regardless of prev failure
    this.queues.set(
      key,
      next.catch(() => void 0).finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      }),
    );
    return next;
  }
}

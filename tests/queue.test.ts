import { describe, it, expect } from "vitest";

interface SyncOp {
  id: string;
  action: string;
  payload: any;
  timestamp: number;
}

class MockSyncQueue {
  private queue: SyncOp[] = [];

  public getQueue(): SyncOp[] {
    return [...this.queue].sort((a, b) => a.timestamp - b.timestamp);
  }

  public enqueue(op: SyncOp) {
    this.queue.push(op);
  }

  public dequeue(id: string) {
    this.queue = this.queue.filter((op) => op.id !== id);
  }

  public clear() {
    this.queue = [];
  }
}

describe("DocFlow Local-First Queue Replay Management", () => {
  it("should maintain a FIFO queue and sort operations correctly by timestamp", () => {
    const queueManager = new MockSyncQueue();

    queueManager.enqueue({ id: "op2", action: "UPDATE", payload: {}, timestamp: 200 });
    queueManager.enqueue({ id: "op1", action: "CREATE", payload: {}, timestamp: 100 });
    queueManager.enqueue({ id: "op3", action: "UPDATE", payload: {}, timestamp: 300 });

    const queue = queueManager.getQueue();
    expect(queue).toHaveLength(3);
    expect(queue[0].id).toBe("op1"); // first operation in time
    expect(queue[1].id).toBe("op2");
    expect(queue[2].id).toBe("op3");
  });

  it("should support removing a dequeued operation from the cache list", () => {
    const queueManager = new MockSyncQueue();

    queueManager.enqueue({ id: "op1", action: "CREATE", payload: {}, timestamp: 100 });
    queueManager.enqueue({ id: "op2", action: "UPDATE", payload: {}, timestamp: 200 });

    queueManager.dequeue("op1");

    const queue = queueManager.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("op2");
  });

  it("should clear the sync queue fully when instructed", () => {
    const queueManager = new MockSyncQueue();

    queueManager.enqueue({ id: "op1", action: "CREATE", payload: {}, timestamp: 100 });
    queueManager.clear();

    const queue = queueManager.getQueue();
    expect(queue).toHaveLength(0);
  });
});

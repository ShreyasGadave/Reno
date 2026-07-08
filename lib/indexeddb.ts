/**
 * IndexedDB wrapper for local-first document storage and sync queue management.
 */

export interface LocalDocument {
  id: string;
  title: string;
  description: string;
  content: {
    blocks: Array<{
      id: string;
      type: string;
      text: string;
      checked?: boolean;
      updatedAt: number;
      updatedBy: string;
    }>;
  };
  visibility: "PRIVATE" | "SHARED" | "PUBLIC";
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  isFavorite: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  version: number; // Server-sync version
  ownerId: string;
  updatedAt: string; // ISO string
  localChangesCount: number; // Counter of unsynced local changes
}

export interface SyncOperation {
  id: string; // Unique GUID or timestamp
  documentId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  payload: Partial<LocalDocument>;
  timestamp: number;
}

export interface LocalVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: any;
  createdBy: string;
  summary: string;
  createdAt: string;
}

const DB_NAME = "DocFlowLocalDB";
const DB_VERSION = 1;

class LocalDB {
  private db: IDBDatabase | null = null;

  public open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      if (typeof window === "undefined") {
        reject(new Error("IndexedDB is only available in the browser"));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;

        // Documents store
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }

        // Sync queue store
        if (!db.objectStoreNames.contains("sync_queue")) {
          const syncQueueStore = db.createObjectStore("sync_queue", {
            keyPath: "id",
          });
          syncQueueStore.createIndex("documentId", "documentId", {
            unique: false,
          });
        }

        // Document versions cache
        if (!db.objectStoreNames.contains("versions")) {
          const versionsStore = db.createObjectStore("versions", {
            keyPath: "id",
          });
          versionsStore.createIndex("documentId", "documentId", {
            unique: false,
          });
        }
      };
    });
  }

  // --- Document Operations ---

  public async getDocuments(): Promise<LocalDocument[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readonly");
      const store = transaction.objectStore("documents");
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async getDocument(id: string): Promise<LocalDocument | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readonly");
      const store = transaction.objectStore("documents");
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async saveDocument(doc: LocalDocument): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      const store = transaction.objectStore("documents");
      const request = store.put(doc);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async deleteDocument(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      const store = transaction.objectStore("documents");
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // --- Sync Queue Operations ---

  public async getSyncQueue(): Promise<SyncOperation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sync_queue", "readonly");
      const store = transaction.objectStore("sync_queue");
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp (FIFO)
        const ops = request.result || [];
        ops.sort((a, b) => a.timestamp - b.timestamp);
        resolve(ops);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async getSyncQueueForDocument(documentId: string): Promise<SyncOperation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sync_queue", "readonly");
      const store = transaction.objectStore("sync_queue");
      const index = store.index("documentId");
      const request = index.getAll(documentId);

      request.onsuccess = () => {
        const ops = request.result || [];
        ops.sort((a, b) => a.timestamp - b.timestamp);
        resolve(ops);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async enqueueSyncOp(op: SyncOperation): Promise<void> {
    const db = await this.open();

    // First update the localChangesCount in the cached document
    try {
      const doc = await this.getDocument(op.documentId);
      if (doc) {
        doc.localChangesCount = (doc.localChangesCount || 0) + 1;
        await this.saveDocument(doc);
      }
    } catch (e) {
      console.warn("Failed to increment localChangesCount:", e);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sync_queue", "readwrite");
      const store = transaction.objectStore("sync_queue");
      const request = store.put(op);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async dequeueSyncOp(id: string, documentId: string): Promise<void> {
    const db = await this.open();

    // Decrement the localChangesCount in the cached document
    try {
      const doc = await this.getDocument(documentId);
      if (doc) {
        doc.localChangesCount = Math.max(0, (doc.localChangesCount || 1) - 1);
        await this.saveDocument(doc);
      }
    } catch (e) {
      console.warn("Failed to decrement localChangesCount:", e);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sync_queue", "readwrite");
      const store = transaction.objectStore("sync_queue");
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async clearSyncQueueForDocument(documentId: string): Promise<void> {
    const db = await this.open();
    const ops = await this.getSyncQueueForDocument(documentId);

    // Reset localChangesCount
    try {
      const doc = await this.getDocument(documentId);
      if (doc) {
        doc.localChangesCount = 0;
        await this.saveDocument(doc);
      }
    } catch (e) {
      console.warn("Failed to reset localChangesCount:", e);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sync_queue", "readwrite");
      const store = transaction.objectStore("sync_queue");

      let completed = 0;
      let errored = false;

      if (ops.length === 0) {
        resolve();
        return;
      }

      ops.forEach((op) => {
        const req = store.delete(op.id);
        req.onsuccess = () => {
          completed++;
          if (completed === ops.length && !errored) {
            resolve();
          }
        };
        req.onerror = () => {
          if (!errored) {
            errored = true;
            reject(req.error);
          }
        };
      });
    });
  }

  // --- Versions Cache Operations ---

  public async getVersionsForDocument(documentId: string): Promise<LocalVersion[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("versions", "readonly");
      const store = transaction.objectStore("versions");
      const index = store.index("documentId");
      const request = index.getAll(documentId);

      request.onsuccess = () => {
        const list = request.result || [];
        list.sort((a, b) => b.version - a.version); // Sort by version desc
        resolve(list);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  public async cacheVersions(versions: LocalVersion[]): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("versions", "readwrite");
      const store = transaction.objectStore("versions");

      let completed = 0;
      let errored = false;

      if (versions.length === 0) {
        resolve();
        return;
      }

      versions.forEach((v) => {
        const req = store.put(v);
        req.onsuccess = () => {
          completed++;
          if (completed === versions.length && !errored) {
            resolve();
          }
        };
        req.onerror = () => {
          if (!errored) {
            errored = true;
            reject(req.error);
          }
        };
      });
    });
  }
}

export const localDB = new LocalDB();

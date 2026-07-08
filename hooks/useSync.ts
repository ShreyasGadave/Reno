"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { localDB, LocalDocument, SyncOperation } from "@/lib/indexeddb";
import { toast } from "sonner";

export type SyncState = "synced" | "syncing" | "offline" | "error";

export function useSync(documentId?: string) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [localDoc, setLocalDoc] = useState<LocalDocument | null>(null);
  const [pendingChanges, setPendingChanges] = useState<number>(0);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Update online status
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    setSyncState(navigator.onLine ? "synced" : "offline");

    const handleOnline = () => {
      setIsOnline(true);
      setSyncState("synced");
      toast.info("Connection restored. Syncing changes...");
      flushQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncState("offline");
      toast.warning("Working offline. Changes will save locally.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Fetch local document from IndexedDB
  const loadLocalDoc = useCallback(async () => {
    if (!documentId) return;
    try {
      const doc = await localDB.getDocument(documentId);
      setLocalDoc(doc);

      // Check sync queue status
      const queue = await localDB.getSyncQueueForDocument(documentId);
      setPendingChanges(queue.length);
      if (queue.length > 0) {
        setSyncState(navigator.onLine ? "error" : "offline");
      }
    } catch (err) {
      console.error("Error loading local doc:", err);
    }
  }, [documentId]);

  useEffect(() => {
    if (documentId) {
      loadLocalDoc();
    }
  }, [documentId, loadLocalDoc]);

  // 3. Core Sync Function
  const syncNow = useCallback(
    async (targetId: string): Promise<boolean> => {
      if (!navigator.onLine) {
        setSyncState("offline");
        return false;
      }

      setSyncState("syncing");

      try {
        const cachedDoc = await localDB.getDocument(targetId);
        if (!cachedDoc) {
          setSyncState("synced");
          return false;
        }

        const queue = await localDB.getSyncQueueForDocument(targetId);

        // Even if the queue is empty, we sync to pull remote updates
        const payload = {
          version: cachedDoc.version,
          title: cachedDoc.title,
          description: cachedDoc.description || "",
          content: cachedDoc.content || { blocks: [] },
          visibility: cachedDoc.visibility,
          status: cachedDoc.status,
          isFavorite: cachedDoc.isFavorite,
          isArchived: cachedDoc.isArchived,
          isDeleted: cachedDoc.isDeleted,
          updatedAt: cachedDoc.updatedAt,
          operations: queue,
        };

        const res = await fetch(`/api/document/${targetId}/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (res.status === 403) {
          toast.error("Access forbidden: Viewers cannot sync edits.");
          setSyncState("error");
          return false;
        }

        if (!res.ok) {
          throw new Error(data?.message || "Sync failed");
        }

        // Successfully merged on server.
        // Update IndexedDB document with the server's merged document and incremented version
        const serverDoc = data.document;
        const mergedDoc: LocalDocument = {
          id: serverDoc.id,
          title: serverDoc.title,
          description: serverDoc.description || "",
          content: serverDoc.content || { blocks: [] },
          visibility: serverDoc.visibility,
          status: serverDoc.status,
          isFavorite: serverDoc.isFavorite,
          isArchived: serverDoc.isArchived,
          isDeleted: serverDoc.isDeleted,
          version: serverDoc.currentVersion,
          ownerId: serverDoc.ownerId,
          updatedAt: serverDoc.updatedAt,
          localChangesCount: 0,
        };

        await localDB.saveDocument(mergedDoc);
        await localDB.clearSyncQueueForDocument(targetId);

        // Update local React state
        setLocalDoc(mergedDoc);
        setPendingChanges(0);
        setSyncState("synced");
        return true;
      } catch (error) {
        console.error("Sync error for doc", targetId, error);
        setSyncState("error");
        return false;
      }
    },
    []
  );

  // Flush all queues across all documents
  const flushQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const queue = await localDB.getSyncQueue();
      if (queue.length === 0) return;

      // Extract unique document IDs to sync
      const docIds = Array.from(new Set(queue.map((op) => op.documentId)));
      for (const id of docIds) {
        await syncNow(id);
      }
    } catch (error) {
      console.error("Failed flushing sync queue:", error);
    }
  }, [syncNow]);

  // Periodic polling for sync checks (runs every 4 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) {
        // If there are unsynced changes in general or for the current doc, flush them
        localDB.getSyncQueue().then((queue) => {
          if (queue.length > 0) {
            flushQueue();
          } else if (documentId && syncState === "synced") {
            // Periodic pull check when idle: checks for remote changes
            syncNow(documentId);
          }
        });
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [documentId, syncState, flushQueue, syncNow]);

  // 4. Update Document Locally (Instant + Enqueue Sync)
  const updateDocumentLocally = useCallback(
    async (updates: Partial<LocalDocument>) => {
      if (!documentId || !localDoc) return;

      try {
        const timestamp = new Date().toISOString();
        const updatedDoc: LocalDocument = {
          ...localDoc,
          ...updates,
          updatedAt: timestamp,
        };

        // 1. Instantly save to local IndexedDB to keep UI responsive
        await localDB.saveDocument(updatedDoc);
        setLocalDoc(updatedDoc);

        // 2. Enqueue sync operation in queue
        const op: SyncOperation = {
          id: Math.random().toString(36).substr(2, 9) + "_" + Date.now(),
          documentId,
          action: "UPDATE",
          payload: updates,
          timestamp: Date.now(),
        };
        await localDB.enqueueSyncOp(op);

        // 3. Update count state
        const queue = await localDB.getSyncQueueForDocument(documentId);
        setPendingChanges(queue.length);

        // 4. Schedule a debounced sync call (1 second) to run after typing stops
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }

        if (navigator.onLine) {
          setSyncState("syncing");
          syncTimeoutRef.current = setTimeout(() => {
            syncNow(documentId);
          }, 1000);
        } else {
          setSyncState("offline");
        }
      } catch (error) {
        console.error("Local edit error:", error);
        toast.error("Failed to save edit locally.");
      }
    },
    [documentId, localDoc, syncNow]
  );

  return {
    isOnline,
    syncState,
    localDoc,
    pendingChanges,
    syncNow: () => documentId && syncNow(documentId),
    updateDocumentLocally,
    loadLocalDoc,
  };
}

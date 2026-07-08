"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { localDB, LocalDocument, SyncOperation } from "@/lib/indexeddb";
import { Socket } from "socket.io-client";
import { toast } from "sonner";

export type SyncState = "synced" | "syncing" | "offline" | "error";

interface ConflictData {
  serverVersion: number;
  serverTitle: string;
  serverContent: any;
  serverUpdatedAt: string;
  clientVersion: number;
}

export function useOfflineSync(
  documentId: string,
  socket: Socket | null,
  socketConnected: boolean,
  onConflict: (data: ConflictData) => void
) {
  const [isOnline, setIsOnline] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [localDoc, setLocalDoc] = useState<LocalDocument | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Connection Event Listeners
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    setSyncState(navigator.onLine ? "synced" : "offline");

    const handleOnline = () => {
      setIsOnline(true);
      toast.info("Network connected. Connecting socket...");
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncState("offline");
      toast.warning("Network disconnected. Editing offline.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Fetch local document cache
  const loadLocalDoc = useCallback(async () => {
    if (!documentId) return;
    try {
      const doc = await localDB.getDocument(documentId);
      setLocalDoc(doc);

      const queue = await localDB.getSyncQueueForDocument(documentId);
      setPendingChanges(queue.length);
      if (queue.length > 0) {
        setSyncState("syncing");
      }
    } catch (err) {
      console.error("Error loading local document:", err);
    }
  }, [documentId]);

  useEffect(() => {
    loadLocalDoc();
  }, [documentId, loadLocalDoc]);

  // 3. Socket event listener mappings
  useEffect(() => {
    if (!socket || !socketConnected || !documentId) return;

    // Joined Document callback
    socket.on("document:joined", async (data: { role: string; document: any }) => {
      try {
        const cached = await localDB.getDocument(documentId);
        const serverDoc = data.document;

        // If local is missing or has older version without pending changes, initialize with server data
        const queue = await localDB.getSyncQueueForDocument(documentId);

        if (!cached || (serverDoc.currentVersion > cached.version && queue.length === 0)) {
          const docToSave: LocalDocument = {
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
          await localDB.saveDocument(docToSave);
          setLocalDoc(docToSave);
        }

        // If client joined and has pending queue items, replay them now
        if (queue.length > 0) {
          replayOfflineQueue();
        }
      } catch (err) {
        console.error("Error handling document join sync:", err);
      }
    });

    // Remote edits broadcast
    socket.on("document:updated", async (data: any) => {
      try {
        const queue = await localDB.getSyncQueueForDocument(documentId);
        // Only adopt remote changes if we do NOT have un-synchronized local changes
        if (queue.length === 0) {
          const cached = await localDB.getDocument(documentId);
          if (cached) {
            cached.content = data.content;
            cached.title = data.title;
            cached.description = data.description || "";
            // Keep version synced to client edits
            cached.version = data.version;
            await localDB.saveDocument(cached);
            setLocalDoc(cached);
            setSyncState("synced");
            
            // Highlight background sync with collaborator initials toast
            toast.info(`${data.userName || "Another collaborator"} updated this document. Changes synced automatically.`, {
              duration: 3000,
            });
          }
        }
      } catch (err) {
        console.error("Error handling remote update:", err);
      }
    });

    // Persistent save success confirmation
    socket.on("document:persisted", async (data: { version: number; updatedAt: string; lastEditedBy: string }) => {
      try {
        const cached = await localDB.getDocument(documentId);
        if (cached) {
          cached.version = data.version;
          cached.updatedAt = data.updatedAt;
          await localDB.saveDocument(cached);
          setLocalDoc(cached);
        }
        await localDB.clearSyncQueueForDocument(documentId);
        setPendingChanges(0);
        setSyncState("synced");
      } catch (err) {
        console.error("Error confirming persistence:", err);
      }
    });

    // Conflict hook
    socket.on("conflict:detected", (data: ConflictData) => {
      setSyncState("error");
      onConflict(data);
    });

    socket.on("document:error", (msg: string) => {
      toast.error(msg);
      setSyncState("error");
    });

    socket.on("document:created", async (data: { tempId: string; document: any }) => {
      try {
        const tempId = data.tempId;
        const serverDoc = data.document;

        await localDB.deleteDocument(tempId);
        await localDB.clearSyncQueueForDocument(tempId);

        const docToSave: LocalDocument = {
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
        await localDB.saveDocument(docToSave);

        if (typeof window !== "undefined" && window.location.pathname.includes(tempId)) {
          window.history.replaceState(null, "", `/document/${serverDoc.id}`);
          window.location.reload();
        }
        
        toast.success("Offline document successfully synchronized!");
      } catch (err) {
        console.error("Failed to process server document creation event:", err);
      }
    });

    return () => {
      socket.off("document:joined");
      socket.off("document:updated");
      socket.off("document:persisted");
      socket.off("conflict:detected");
      socket.off("document:error");
      socket.off("document:created");
    };
  }, [socket, socketConnected, documentId, onConflict]);

  // 4. Replay offline queue
  const replayOfflineQueue = useCallback(async () => {
    if (!socket || !socketConnected || !isOnline) return;

    try {
      const queue = await localDB.getSyncQueueForDocument(documentId);
      if (queue.length === 0) return;

      setSyncState("syncing");

      // Handle offline creation synchronization
      if (queue[0]?.action === "CREATE") {
        socket.emit("document:create", {
          tempId: documentId,
          payload: queue[0].payload,
        });
        return;
      }

      // Pull final local state to send to the server
      const local = await localDB.getDocument(documentId);
      if (!local) return;

      // Send update payload to server
      socket.emit("document:update", {
        documentId,
        payload: {
          version: local.version,
          title: local.title,
          description: local.description,
          content: local.content,
          visibility: local.visibility,
          status: local.status,
          isFavorite: local.isFavorite,
          isArchived: local.isArchived,
          isDeleted: local.isDeleted,
          updatedAt: local.updatedAt,
        },
        force: false,
      });
    } catch (err) {
      console.error("Failed replaying operations queue:", err);
    }
  }, [socket, socketConnected, isOnline, documentId]);

  // Replay when socket connects
  useEffect(() => {
    if (socketConnected && isOnline) {
      replayOfflineQueue();
    }
  }, [socketConnected, isOnline, replayOfflineQueue]);

  // 5. Update local cache and emit updates
  const updateDocument = useCallback(
    async (updates: Partial<LocalDocument>) => {
      if (!documentId || !localDoc) return;

      try {
        const timestamp = new Date().toISOString();
        const updatedDoc: LocalDocument = {
          ...localDoc,
          ...updates,
          updatedAt: timestamp,
        };

        // 1. Instantly save to IndexedDB local cache for responsive UI
        await localDB.saveDocument(updatedDoc);
        setLocalDoc(updatedDoc);

        // 2. Add operation to queue
        const op: SyncOperation = {
          id: Math.random().toString(36).substr(2, 9) + "_" + Date.now(),
          documentId,
          action: "UPDATE",
          payload: updates,
          timestamp: Date.now(),
        };
        await localDB.enqueueSyncOp(op);

        const queue = await localDB.getSyncQueueForDocument(documentId);
        setPendingChanges(queue.length);

        // 3. Send over socket if online, otherwise flag offline
        if (socketConnected && isOnline) {
          setSyncState("syncing");

          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }

          // Debounce slightly to allow smooth rapid typing broadcast
          typingTimeoutRef.current = setTimeout(() => {
            socket?.emit("document:update", {
              documentId,
              payload: {
                version: updatedDoc.version,
                title: updatedDoc.title,
                description: updatedDoc.description,
                content: updatedDoc.content,
                visibility: updatedDoc.visibility,
                status: updatedDoc.status,
                isFavorite: updatedDoc.isFavorite,
                isArchived: updatedDoc.isArchived,
                isDeleted: updatedDoc.isDeleted,
                updatedAt: timestamp,
              },
              force: false,
            });
          }, 400); // 400ms typing debouncer for broadcasts
        } else {
          setSyncState("offline");
        }
      } catch (err) {
        console.error("Local update error:", err);
      }
    },
    [documentId, localDoc, socket, socketConnected, isOnline]
  );

  // 6. Force sync choices (conflict resolution)
  const resolveConflictChoice = useCallback(
    async (choice: "server" | "client" | "merge", serverData?: ConflictData) => {
      if (!documentId || !localDoc || !socket || !socketConnected) return;

      try {
        if (choice === "server" && serverData) {
          // 1. Adopt Server Version
          const updatedDoc: LocalDocument = {
            ...localDoc,
            title: serverData.serverTitle,
            content: serverData.serverContent,
            version: serverData.serverVersion,
            localChangesCount: 0,
            updatedAt: serverData.serverUpdatedAt,
          };
          await localDB.saveDocument(updatedDoc);
          await localDB.clearSyncQueueForDocument(documentId);
          setLocalDoc(updatedDoc);
          setPendingChanges(0);
          setSyncState("synced");
          socket.emit("conflict:resolved", {
            documentId,
            resolutionChoice: "server",
            localVersion: localDoc.version,
          });
          toast.success("Adopted server changes.");
        } else if (choice === "client") {
          // 2. Overwrite Server
          setSyncState("syncing");
          socket.emit("document:update", {
            documentId,
            payload: {
              version: localDoc.version,
              title: localDoc.title,
              description: localDoc.description,
              content: localDoc.content,
              visibility: localDoc.visibility,
              status: localDoc.status,
              isFavorite: localDoc.isFavorite,
              isArchived: localDoc.isArchived,
              isDeleted: localDoc.isDeleted,
              updatedAt: localDoc.updatedAt,
              resolutionChoice: "client",
            },
            force: true, // Bypass conflict check
          });
          toast.info("Overwriting server state...");
        } else if (choice === "merge" && serverData) {
          // 3. Local 3-Way Merge
          setSyncState("syncing");
          toast.info("Merging modifications...");

          // Retrieve base version
          const baseRes = await fetch(`/api/document/${documentId}/versions`);
          let baseBlocks: any[] = [];
          if (baseRes.ok) {
            const data = await baseRes.json();
            const baseVer = data.versions?.find((v: any) => v.version === localDoc.version);
            if (baseVer) {
              baseBlocks = baseVer.content?.blocks || [];
            }
          }

          const clientBlocks = localDoc.content.blocks || [];
          const serverBlocks = serverData.serverContent?.blocks || [];

          // Perform merge logic
          const merged = localThreeWayMerge(baseBlocks, clientBlocks, serverBlocks);

          const mergedDoc: LocalDocument = {
            ...localDoc,
            title: localDoc.title, // keep local title or server title
            content: { blocks: merged },
            updatedAt: new Date().toISOString(),
          };

          await localDB.saveDocument(mergedDoc);
          setLocalDoc(mergedDoc);

          // Force upload merged state
          socket.emit("document:update", {
            documentId,
            payload: {
              version: localDoc.version,
              title: mergedDoc.title,
              description: mergedDoc.description,
              content: mergedDoc.content,
              visibility: mergedDoc.visibility,
              status: mergedDoc.status,
              isFavorite: mergedDoc.isFavorite,
              isArchived: mergedDoc.isArchived,
              isDeleted: mergedDoc.isDeleted,
              updatedAt: mergedDoc.updatedAt,
              resolutionChoice: "merge",
            },
            force: true,
          });
        }
      } catch (err) {
        console.error("Conflict resolution failed:", err);
        setSyncState("error");
      }
    },
    [documentId, localDoc, socket, socketConnected]
  );

  return {
    isOnline,
    syncState,
    localDoc,
    pendingChanges,
    updateDocument,
    resolveConflictChoice,
    loadLocalDoc,
    syncNow: replayOfflineQueue,
  };
}

// 3-Way Block-Level merge function client-side duplicate
function localThreeWayMerge(baseBlocks: any[], clientBlocks: any[], serverBlocks: any[]): any[] {
  const baseMap = new Map(baseBlocks.map((b) => [b.id, b]));
  const serverMap = new Map(serverBlocks.map((b) => [b.id, b]));
  const clientMap = new Map(clientBlocks.map((b) => [b.id, b]));

  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...serverMap.keys(),
    ...clientMap.keys(),
  ]);

  const resolvedMap = new Map<string, any>();

  for (const id of allBlockIds) {
    const baseB = baseMap.get(id);
    const serverB = serverMap.get(id);
    const clientB = clientMap.get(id);

    if (baseB && serverB && clientB) {
      const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
      const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

      if (clientChanged && !serverChanged) {
        resolvedMap.set(id, clientB);
      } else if (serverChanged && !clientChanged) {
        resolvedMap.set(id, serverB);
      } else if (clientChanged && serverChanged) {
        if (clientB.updatedAt >= serverB.updatedAt) {
          resolvedMap.set(id, clientB);
        } else {
          resolvedMap.set(id, serverB);
        }
      } else {
        resolvedMap.set(id, baseB);
      }
    } else if (!baseB) {
      if (clientB && !serverB) {
        resolvedMap.set(id, clientB);
      } else if (serverB && !clientB) {
        resolvedMap.set(id, serverB);
      } else if (clientB && serverB) {
        resolvedMap.set(id, clientB.updatedAt >= serverB.updatedAt ? clientB : serverB);
      }
    } else {
      if (serverB && !clientB) {
        if (JSON.stringify(serverB) !== JSON.stringify(baseB)) {
          resolvedMap.set(id, serverB);
        }
      } else if (clientB && !serverB) {
        if (JSON.stringify(clientB) !== JSON.stringify(baseB)) {
          resolvedMap.set(id, clientB);
        }
      }
    }
  }

  const finalSequence: any[] = [];
  const addedIds = new Set<string>();

  for (const block of clientBlocks) {
    if (resolvedMap.has(block.id)) {
      finalSequence.push(resolvedMap.get(block.id));
      addedIds.add(block.id);
    }
  }

  for (let i = 0; i < serverBlocks.length; i++) {
    const block = serverBlocks[i];
    if (resolvedMap.has(block.id) && !addedIds.has(block.id)) {
      let insertIndex = -1;
      for (let j = i - 1; j >= 0; j--) {
        const prevId = serverBlocks[j].id;
        const idx = finalSequence.findIndex((b) => b.id === prevId);
        if (idx !== -1) {
          insertIndex = idx + 1;
          break;
        }
      }

      if (insertIndex !== -1) {
        finalSequence.splice(insertIndex, 0, resolvedMap.get(block.id));
      } else {
        finalSequence.push(resolvedMap.get(block.id));
      }
      addedIds.add(block.id);
    }
  }

  return finalSequence;
}

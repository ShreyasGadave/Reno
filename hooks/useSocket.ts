"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
import { Socket } from "socket.io-client";

export interface Collaborator {
  socketId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  cursor: { blockId: string; offset: number } | null;
  typing: boolean;
}

export function useSocket(documentId: string, userName?: string) {
  const [socketConnected, setSocketConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Initialize and connect socket
  useEffect(() => {
    if (!documentId) return;

    const socket = getSocket();
    socketRef.current = socket;

    if (!socket.connected) {
      socket.connect();
    }

    setSocketConnected(socket.connected);

    const handleConnect = () => {
      setSocketConnected(true);
      socket.emit("join-document", { documentId, name: userName });
    };

    const handleDisconnect = () => {
      setSocketConnected(false);
    };

    const handlePresenceUpdate = (members: Collaborator[]) => {
      // Exclude current user from collaborators list to simplify cursor rendering
      const filtered = members.filter((m) => m.socketId !== socket.id);
      setCollaborators(filtered);
    };

    const handleRemoteCursor = ({ socketId, cursor }: any) => {
      setCollaborators((prev) =>
        prev.map((c) => (c.socketId === socketId ? { ...c, cursor } : c))
      );
    };

    const handleRemoteTyping = ({ socketId, typing }: any) => {
      setCollaborators((prev) =>
        prev.map((c) => (c.socketId === socketId ? { ...c, typing } : c))
      );
    };

    // Attach listeners
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("document:cursor", handleRemoteCursor);
    socket.on("document:typing", handleRemoteTyping);

    // If socket is already connected when mounting, emit join-document immediately
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      // Clean up listeners and emit leave or let server disconnect do it
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("document:cursor", handleRemoteCursor);
      socket.off("document:typing", handleRemoteTyping);
    };
  }, [documentId, userName]);

  // Emit cursor positions
  const sendCursor = useCallback(
    (cursor: { blockId: string; offset: number } | null) => {
      if (socketRef.current?.connected && documentId) {
        socketRef.current.emit("document:cursor", { documentId, cursor });
      }
    },
    [documentId]
  );

  // Emit typing updates
  const sendTyping = useCallback(
    (typing: boolean) => {
      if (socketRef.current?.connected && documentId) {
        socketRef.current.emit("document:typing", { documentId, typing });
      }
    },
    [documentId]
  );

  return {
    socketConnected,
    collaborators,
    sendCursor,
    sendTyping,
    socket: socketRef.current,
  };
}

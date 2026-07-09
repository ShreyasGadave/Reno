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
  const userNameRef = useRef(userName);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

  useEffect(() => {
    if (!documentId) return;

    const socket = getSocket();
    socketRef.current = socket;

    if (!socket.connected) socket.connect();
    setSocketConnected(socket.connected);

    const handleConnect = () => {
      setSocketConnected(true);
      socket.emit("join-document", { documentId, name: userNameRef.current });
    };

    const handleDisconnect = () => {
      console.log("🔌 [Socket Event] Disconnected from Socket Server.");
      setSocketConnected(false);
    };

    const handleConnectError = (err: Error) => {
      console.error("🔌 [Socket Event] Connection Error:", err.message);
    };

    const handlePresenceUpdate = (members: Collaborator[]) => {
      console.log("🔌 [Socket Event] Presence update received. Collaborator count:", members.length);
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
    socket.on("connect_error", handleConnectError);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("document:cursor", handleRemoteCursor);
    socket.on("document:typing", handleRemoteTyping);

    // If socket is already connected when mounting, emit join-document immediately
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      console.log("🔌 [Socket Connection] Cleaning up socket listeners for document:", documentId);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("document:cursor", handleRemoteCursor);
      socket.off("document:typing", handleRemoteTyping);
      
      // Close socket connection on component unmount to prevent leaks and clear presence
          socket.disconnect();
    };
  }, [documentId]);

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

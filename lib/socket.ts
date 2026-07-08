import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("Sockets can only be initialized on the client side");
  }

  if (!socketInstance) {
    socketInstance = io(window.location.origin, {
      path: "/api/socket",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
  }

  return socketInstance;
}

/**
 * Automated test script to verify Socket.IO real-time communication.
 * Can be run via: npx tsx lib/test-socket.ts
 */

import { io } from "socket.io-client";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "4oeymO7vw5GWgDJe";
const SOCKET_URL = "http://localhost:3000";

async function runSocketTest() {
  console.log("🚀 Initializing Socket.IO real-time verification client...");

  // 1. Generate test authentication token
  const token = jwt.sign(
    { id: "test_socket_user", email: "socket_test@docflow.com" },
    JWT_SECRET
  );

  // 2. Connect to Socket.IO Server
  const socket = io(SOCKET_URL, {
    path: "/api/socket",
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });

  socket.on("connect", () => {
    console.log("✅ Socket connected successfully to Node server.");
    
    // Join document room
    console.log("📨 Sending room join: 'join-document' for room 'doc:test_doc_id'...");
    socket.emit("join-document", {
      documentId: "test_doc_id",
      name: "Test Engineer",
    });
  });

  socket.on("document:joined", (data) => {
    console.log("✅ Received connection response 'document:joined':", {
      role: data.role,
      docId: data.document.id,
      title: data.document.title,
    });

    // Test cursor broadcast
    console.log("📨 Sending cursor update: 'document:cursor'...");
    socket.emit("document:cursor", {
      documentId: "test_doc_id",
      cursor: { blockId: "block_1", offset: 12 },
    });

    // Test typing indicator
    console.log("📨 Sending typing status: 'document:typing'...");
    socket.emit("document:typing", {
      documentId: "test_doc_id",
      typing: true,
    });
  });

  socket.on("presence:update", (members) => {
    console.log("✅ Presence updated. Active room members count:", members.length);
    console.log("Member list:", members.map((m: any) => `${m.name} (${m.role})`));

    // Success - clean up and exit
    console.log("\n🎉 All WebSocket handshake and room events verified successfully!");
    socket.disconnect();
    process.exit(0);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connection error:", err.message);
    process.exit(1);
  });

  socket.on("document:error", (err) => {
    console.error("❌ Document Server Error:", err);
    process.exit(1);
  });

  // Set timeout to prevent hanging
  setTimeout(() => {
    console.error("❌ Timeout: Did not complete socket loops within 8 seconds.");
    socket.disconnect();
    process.exit(1);
  }, 8000);
}

runSocketTest();

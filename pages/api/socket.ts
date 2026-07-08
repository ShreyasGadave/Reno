import { NextApiRequest, NextApiResponse } from "next";
import { Server as IOServer, Socket } from "socket.io";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

interface SocketServer extends HTTPServer {
  io?: IOServer;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

// Heuristic cookie parser
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join("="));
    }
  });
  return list;
}

// Room presence map: roomId -> Map<socketId, memberInfo>
const roomsPresence = new Map<string, Map<string, any>>();

// Debounced DB saves: docId -> Timeout
const saveTimeouts = new Map<string, NodeJS.Timeout>();

export default function handler(
  req: NextApiRequest,
  res: NextApiResponseWithSocket
) {
  if (res.socket.server.io) {
    res.end();
    return;
  }

  const io = new IOServer(res.socket.server as any, {
    path: "/api/socket",
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  res.socket.server.io = io;

  // Socket middleware for Authentication
  io.use((socket: Socket, next) => {
    try {
      const cookies = parseCookies(socket.request.headers.cookie);
      const token = cookies.token || (socket.handshake.auth?.token as string);

      if (!token) {
        return next(new Error("Authentication failed: Token missing"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        id: string;
        email: string;
      };

      // Attach user info to socket
      (socket as any).user = {
        id: decoded.id,
        email: decoded.email,
      };

      next();
    } catch (err) {
      return next(new Error("Authentication failed: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;

    socket.on("document:create", async ({ tempId, payload }) => {
      try {
        const userId = user.id;

        // Create the document in PostgreSQL
        const document = await prisma.document.create({
          data: {
            title: payload.title || "Untitled Document",
            description: payload.description || "",
            content: payload.content || { blocks: [] },
            ownerId: userId,
            currentVersion: 1,
          },
        });

        // Write version history checkpoint with initial hash
        const contentHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(payload.content || { blocks: [] }))
          .digest("hex");

        await prisma.documentVersion.create({
          data: {
            documentId: document.id,
            version: 1,
            title: document.title,
            content: payload.content || { blocks: [] },
            createdBy: user.email,
            summary: `Initial creation | Hash: ${contentHash}`,
          },
        });

        socket.emit("document:created", {
          tempId,
          document,
        });
      } catch (err) {
        console.error("Document create error in socket:", err);
        socket.emit("document:error", "Failed to create document on server");
      }
    });

    socket.on("join-document", async ({ documentId, name }) => {
      try {
        const userId = user.id;

        // Verify document visibility / roles
        const document = await prisma.document.findUnique({
          where: { id: documentId },
          include: {
            collaborators: {
              where: { userId },
            },
          },
        });

        if (!document) {
          socket.emit("document:error", "Document not found");
          return;
        }

        // Determine Role
        let role: "OWNER" | "EDITOR" | "VIEWER" = "VIEWER";
        if (document.ownerId === userId) {
          role = "OWNER";
        } else {
          const collab = document.collaborators[0];
          if (collab) {
            role = collab.role;
          } else if (document.visibility !== "PUBLIC") {
            socket.emit("document:error", "Access denied");
            return;
          }
        }

        const roomName = `doc:${documentId}`;
        socket.join(roomName);

        // Store user presence details
        if (!roomsPresence.has(roomName)) {
          roomsPresence.set(roomName, new Map());
        }

        const roomMembers = roomsPresence.get(roomName)!;
        roomMembers.set(socket.id, {
          socketId: socket.id,
          userId,
          name: name || user.email,
          email: user.email,
          role,
          cursor: null,
          typing: false,
        });

        // Broadcast presence
        const membersList = Array.from(roomMembers.values());
        io.to(roomName).emit("presence:update", membersList);

        // Send current server document state to the joiner
        socket.emit("document:joined", {
          role,
          document,
        });
      } catch (err) {
        console.error("Join document error:", err);
        socket.emit("document:error", "Internal server error during join");
      }
    });

    // Handle updates
    socket.on("document:update", async ({ documentId, payload, force }) => {
      const roomName = `doc:${documentId}`;
      const roomMembers = roomsPresence.get(roomName);
      if (!roomMembers || !roomMembers.has(socket.id)) return;

      const member = roomMembers.get(socket.id);
      if (member.role === "VIEWER") {
        socket.emit("document:error", "Viewers cannot push document edits");
        return;
      }

      try {
        const serverDoc = await prisma.document.findUnique({
          where: { id: documentId },
        });

        if (!serverDoc) return;

        // Conflict check: only check if there are other concurrent collaborators in the room
        if (serverDoc.currentVersion > payload.version && !force) {
          const activeCollaboratorsCount = roomMembers.size;
          
          if (activeCollaboratorsCount > 1) {
            const baseVersion = await prisma.documentVersion.findFirst({
              where: {
                documentId,
                version: payload.version,
              },
            });

            if (baseVersion) {
              const baseBlocks = (baseVersion.content as any)?.blocks || [];
              const clientBlocks = payload.content?.blocks || [];
              const serverBlocks = (serverDoc.content as any)?.blocks || [];

              if (hasOverlappingConflict(baseBlocks, clientBlocks, serverBlocks)) {
                // Compile conflicting blocks details
                const conflictingBlocks = baseBlocks.filter((baseB: any) => {
                  const clientB = clientBlocks.find((cb: any) => cb.id === baseB.id);
                  const serverB = serverBlocks.find((sb: any) => sb.id === baseB.id);
                  if (clientB && serverB) {
                    const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
                    const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);
                    const contentIdentical =
                      clientB.text === serverB.text &&
                      clientB.type === serverB.type &&
                      clientB.checked === serverB.checked;
                    return clientChanged && serverChanged && !contentIdentical;
                  }
                  return false;
                });

                const modifiedBlocks = conflictingBlocks.map((baseB: any) => {
                  const clientB = clientBlocks.find((cb: any) => cb.id === baseB.id);
                  const serverB = serverBlocks.find((sb: any) => sb.id === baseB.id);
                  return {
                    blockId: baseB.id,
                    type: baseB.type,
                    localContent: clientB?.text || "",
                    remoteContent: serverB?.text || "",
                  };
                });

                socket.emit("conflict:detected", {
                  hasConflict: true,
                  documentId,
                  conflictingUser: {
                    name: serverDoc.lastEditedBy || "Another Collaborator",
                    updatedAt: serverDoc.updatedAt,
                  },
                  localVersion: payload.version,
                  serverVersion: serverDoc.currentVersion,
                  modifiedBlocks,
                  serverTitle: serverDoc.title,
                  serverContent: serverDoc.content,
                  serverUpdatedAt: serverDoc.updatedAt,
                });
                return;
              } else {
                const mergedBlocks = serverThreeWayMerge(baseBlocks, clientBlocks, serverBlocks);
                payload.content = {
                  ...payload.content,
                  blocks: mergedBlocks,
                };
              }
            } else {
              socket.emit("conflict:detected", {
                hasConflict: true,
                documentId,
                conflictingUser: {
                  name: serverDoc.lastEditedBy || "Another Collaborator",
                  updatedAt: serverDoc.updatedAt,
                },
                localVersion: payload.version,
                serverVersion: serverDoc.currentVersion,
                modifiedBlocks: [],
                serverTitle: serverDoc.title,
                serverContent: serverDoc.content,
                serverUpdatedAt: serverDoc.updatedAt,
              });
              return;
            }
          }
        }

        // Broadcast the update immediately to other collaborators for real-time responsiveness
        socket.to(roomName).emit("document:updated", {
          userId: user.id,
          userName: member.name,
          version: payload.version, // optimistic/client version
          content: payload.content,
          title: payload.title,
          description: payload.description,
        });

        // Schedule database persistence (Debounced writes)
        if (saveTimeouts.has(documentId)) {
          clearTimeout(saveTimeouts.get(documentId));
        }

        const nextVersion = force ? serverDoc.currentVersion + 1 : payload.version + 1;

        const timeout = setTimeout(async () => {
          try {
            saveTimeouts.delete(documentId);

            // Compute counts
            const blocks = payload.content?.blocks || [];
            const wordCount = blocks.reduce(
              (acc: number, b: any) =>
                acc + (b.text ? b.text.trim().split(/\s+/).filter(Boolean).length : 0),
              0
            );
            const characterCount = blocks.reduce(
              (acc: number, b: any) => acc + (b.text ? b.text.length : 0),
              0
            );

            // Update database state
            const updated = await prisma.document.update({
              where: { id: documentId },
              data: {
                title: payload.title,
                description: payload.description || "",
                content: payload.content,
                currentVersion: nextVersion,
                wordCount,
                characterCount,
                lastEditedBy: member.name,
                lastEditedAt: new Date(),
              },
            });

            // Log conflict resolution audit record if forced resolve was chosen
            if (force) {
              await prisma.activity.create({
                data: {
                  documentId,
                  userId: user.id,
                  action: "UPDATED",
                  metadata: {
                    conflictResolved: true,
                    resolution: payload.resolutionChoice || "merge",
                    localVersion: payload.version,
                    serverVersion: serverDoc.currentVersion,
                    resolvedAt: new Date().toISOString(),
                  },
                },
              });
            }

            // Write version history checkpoint with cryptographic SHA-256 hash of blocks content
            const contentHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(payload.content || { blocks: [] }))
              .digest("hex");
            const baseSummary = force ? `Forced overwrite / merged conflict (v${nextVersion})` : `Collaborative update (v${nextVersion})`;
            await prisma.documentVersion.create({
              data: {
                documentId,
                version: nextVersion,
                title: payload.title,
                content: payload.content,
                createdBy: member.name,
                summary: `${baseSummary} | Hash: ${contentHash}`,
              },
            });

            // Broadcast persistent database sync success
            io.to(roomName).emit("document:persisted", {
              version: nextVersion,
              updatedAt: updated.updatedAt,
              lastEditedBy: updated.lastEditedBy,
            });
          } catch (dbErr) {
            console.error("Database save failed inside socket handler:", dbErr);
            socket.emit("document:error", "Failed to persist document changes");
          }
        }, 2000); // 2 seconds debouncer

        saveTimeouts.set(documentId, timeout);
      } catch (err) {
        console.error("Update message handler error:", err);
      }
    });

    // Handle conflict resolution tracking logs
    socket.on("conflict:resolved", async ({ documentId, resolutionChoice, localVersion }) => {
      try {
        await prisma.activity.create({
          data: {
            documentId,
            userId: user.id,
            action: "UPDATED",
            metadata: {
              conflictResolved: true,
              resolution: resolutionChoice,
              localVersion,
              resolvedAt: new Date().toISOString(),
            },
          },
        });
      } catch (err) {
        console.error("Conflict resolved log error:", err);
      }
    });

    // Handle cursor position & selections
    socket.on("document:cursor", ({ documentId, cursor }) => {
      const roomName = `doc:${documentId}`;
      const roomMembers = roomsPresence.get(roomName);
      if (!roomMembers || !roomMembers.has(socket.id)) return;

      const member = roomMembers.get(socket.id)!;
      member.cursor = cursor;

      socket.to(roomName).emit("document:cursor", {
        socketId: socket.id,
        userId: user.id,
        name: member.name,
        cursor,
      });
    });

    // Handle typing status
    socket.on("document:typing", ({ documentId, typing }) => {
      const roomName = `doc:${documentId}`;
      const roomMembers = roomsPresence.get(roomName);
      if (!roomMembers || !roomMembers.has(socket.id)) return;

      const member = roomMembers.get(socket.id)!;
      member.typing = typing;

      socket.to(roomName).emit("document:typing", {
        socketId: socket.id,
        userId: user.id,
        name: member.name,
        typing,
      });
    });

    // Disconnect handling
    socket.on("disconnect", () => {
      roomsPresence.forEach((roomMembers, roomName) => {
        if (roomMembers.has(socket.id)) {
          roomMembers.delete(socket.id);
          
          if (roomMembers.size === 0) {
            roomsPresence.delete(roomName);
          } else {
            // Broadcast remaining members list
            io.to(roomName).emit("presence:update", Array.from(roomMembers.values()));
          }
        }
      });
    });
  });

  res.end();
}

function hasOverlappingConflict(baseBlocks: any[], clientBlocks: any[], serverBlocks: any[]): boolean {
  const baseMap = new Map((baseBlocks || []).map((b) => [b.id, b]));
  const serverMap = new Map((serverBlocks || []).map((b) => [b.id, b]));
  const clientMap = new Map((clientBlocks || []).map((b) => [b.id, b]));

  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...serverMap.keys(),
    ...clientMap.keys(),
  ]);

  for (const id of allBlockIds) {
    const baseB = baseMap.get(id);
    const serverB = serverMap.get(id);
    const clientB = clientMap.get(id);

    if (baseB && serverB && clientB) {
      const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
      const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

      const contentIdentical =
        clientB.text === serverB.text &&
        clientB.type === serverB.type &&
        clientB.checked === serverB.checked;

      if (clientChanged && serverChanged && !contentIdentical) {
        return true;
      }
    }
  }

  return false;
}

function serverThreeWayMerge(baseBlocks: any[], clientBlocks: any[], serverBlocks: any[]): any[] {
  const baseMap = new Map((baseBlocks || []).map((b) => [b.id, b]));
  const serverMap = new Map((serverBlocks || []).map((b) => [b.id, b]));
  const clientMap = new Map((clientBlocks || []).map((b) => [b.id, b]));

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

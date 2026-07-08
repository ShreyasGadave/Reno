import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

// Block structure validator
const BlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string().max(10000), // Max 10,000 characters per block (OOM Prevention)
  checked: z.boolean().optional(),
  updatedAt: z.number(),
  updatedBy: z.string(),
});

const SyncPayloadSchema = z.object({
  version: z.number(), // Client's last synced version
  title: z.string().min(1),
  description: z.string().optional(),
  content: z.object({
    blocks: z.array(BlockSchema).max(500), // Max 500 blocks per document (OOM Prevention)
  }),
  visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]),
  status: z.enum(["ACTIVE", "ARCHIVED", "DELETED"]),
  isFavorite: z.boolean(),
  isArchived: z.boolean(),
  isDeleted: z.boolean(),
  updatedAt: z.string(),
});

// Helper to determine user's role
async function getDocumentRole(documentId: string, userId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      collaborators: {
        where: { userId },
      },
    },
  });

  if (!document) return null;

  if (document.ownerId === userId) {
    return "OWNER";
  }

  const collab = document.collaborators[0];
  if (collab) {
    return collab.role;
  }

  if (document.visibility === "PUBLIC") {
    return "VIEWER";
  }

  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: documentId } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const role = await getDocumentRole(documentId, userId);

    if (!role) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // Viewers cannot push state updates to the real-time server
    if (role === "VIEWER") {
      return NextResponse.json(
        { message: "Viewers are not authorized to sync changes." },
        { status: 403 }
      );
    }

    // 1. OOM Prevention: Limit Payload Size
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
      return NextResponse.json(
        { message: "Payload too large. Maximum size is 1MB." },
        { status: 413 }
      );
    }

    const body = await req.json();
    const result = SyncPayloadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: "Invalid payload schema", errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const clientPayload = result.data;
    const clientLastSyncVersion = clientPayload.version;

    // Fetch current server state
    const serverDocument = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!serverDocument) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    const serverVersion = serverDocument.currentVersion;
    let mergedBlocks = clientPayload.content.blocks;
    let mergedTitle = clientPayload.title;
    let mergedDescription = clientPayload.description || "";

    // 2. Conflict Resolution Trigger (Merge only if client was out-of-date)
    if (serverVersion > clientLastSyncVersion) {
      // Retrieve the base version (the version the client started editing from)
      const baseVersion = await prisma.documentVersion.findFirst({
        where: {
          documentId,
          version: clientLastSyncVersion,
        },
      });

      const baseBlocks = (baseVersion?.content as any)?.blocks || [];
      const serverBlocks = (serverDocument.content as any)?.blocks || [];
      const clientBlocks = clientPayload.content.blocks;

      // Map-based lookup
      const baseMap = new Map<string, any>(baseBlocks.map((b: any) => [b.id, b]));
      const serverMap = new Map<string, any>(serverBlocks.map((b: any) => [b.id, b]));
      const clientMap = new Map<string, any>(clientBlocks.map((b: any) => [b.id, b]));

      const allBlockIds = new Set([
        ...baseMap.keys(),
        ...serverMap.keys(),
        ...clientMap.keys(),
      ]);

      const resolvedBlocksMap = new Map<string, any>();

      // Apply 3-Way Merge logic to each block
      for (const id of allBlockIds) {
        const baseB = baseMap.get(id);
        const serverB = serverMap.get(id);
        const clientB = clientMap.get(id);

        if (baseB && serverB && clientB) {
          // Block existed everywhere
          const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
          const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

          if (clientChanged && !serverChanged) {
            resolvedBlocksMap.set(id, clientB);
          } else if (serverChanged && !clientChanged) {
            resolvedBlocksMap.set(id, serverB);
          } else if (clientChanged && serverChanged) {
            // Conflict: Resolve using LWW timestamp
            if (clientB.updatedAt >= serverB.updatedAt) {
              resolvedBlocksMap.set(id, clientB);
            } else {
              resolvedBlocksMap.set(id, serverB);
            }
          } else {
            resolvedBlocksMap.set(id, baseB);
          }
        } else if (!baseB) {
          // New Block: added in client, server, or both
          if (clientB && !serverB) {
            resolvedBlocksMap.set(id, clientB);
          } else if (serverB && !clientB) {
            resolvedBlocksMap.set(id, serverB);
          } else if (clientB && serverB) {
            // Added in both with same ID (fallback LWW)
            resolvedBlocksMap.set(
              id,
              clientB.updatedAt >= serverB.updatedAt ? clientB : serverB
            );
          }
        } else {
          // Deleted Block: Existed in base, but deleted in client or server (or both)
          if (serverB && !clientB) {
            // Deleted in client, check if modified in server
            const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);
            if (serverChanged) {
              resolvedBlocksMap.set(id, serverB); // Restore: server modified it
            }
            // If not changed, let client delete it (omit from map)
          } else if (clientB && !serverB) {
            // Deleted in server, check if modified in client
            const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
            if (clientChanged) {
              resolvedBlocksMap.set(id, clientB); // Restore: client modified it
            }
            // If not changed, let server delete it
          }
          // If deleted in both, do nothing (omit)
        }
      }

      // Reconstruct sequence order.
      // We merge client order and server order.
      // Start with client blocks list. Append any server-added/restored blocks that are missing.
      const finalSequence: any[] = [];
      const addedIds = new Set<string>();

      // First pass: add blocks in client order if they exist in resolved set
      for (const block of clientBlocks) {
        if (resolvedBlocksMap.has(block.id)) {
          finalSequence.push(resolvedBlocksMap.get(block.id));
          addedIds.add(block.id);
        }
      }

      // Second pass: insert server blocks that are in the resolved set but missing in client sequence.
      // We insert them at their relative index to preserve context.
      for (let i = 0; i < serverBlocks.length; i++) {
        const block = serverBlocks[i];
        if (resolvedBlocksMap.has(block.id) && !addedIds.has(block.id)) {
          // Find preceding block that is already added
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
            finalSequence.splice(insertIndex, 0, resolvedBlocksMap.get(block.id));
          } else {
            finalSequence.push(resolvedBlocksMap.get(block.id)); // Append if no predecessor found
          }
          addedIds.add(block.id);
        }
      }

      mergedBlocks = finalSequence;

      // Reconcile Title / Description conflict (simple LWW)
      const serverUpdatedAtTime = new Date(serverDocument.updatedAt).getTime();
      const clientUpdatedAtTime = new Date(clientPayload.updatedAt).getTime();

      if (serverUpdatedAtTime > clientUpdatedAtTime) {
        mergedTitle = serverDocument.title;
        mergedDescription = serverDocument.description || "";
      }
    }

    // 3. Save new state, increment version
    const nextVersion = serverVersion + 1;
    const finalContent = { blocks: mergedBlocks };

    const wordCount = mergedBlocks.reduce(
      (acc, b) => acc + (b.text ? b.text.trim().split(/\s+/).filter(Boolean).length : 0),
      0
    );
    const characterCount = mergedBlocks.reduce((acc, b) => acc + (b.text ? b.text.length : 0), 0);

    const updatedDoc = await prisma.document.update({
      where: { id: documentId },
      data: {
        title: mergedTitle,
        description: mergedDescription,
        content: finalContent,
        currentVersion: nextVersion,
        visibility: clientPayload.visibility,
        status: clientPayload.status,
        isFavorite: clientPayload.isFavorite,
        isArchived: clientPayload.isArchived,
        isDeleted: clientPayload.isDeleted,
        wordCount,
        characterCount,
        lastEditedBy: session.user.name || session.user.email,
        lastEditedAt: new Date(),
      },
    });

    // Auto-create snapshot history entry for this sync update
    await prisma.documentVersion.create({
      data: {
        documentId,
        version: nextVersion,
        title: mergedTitle,
        content: finalContent,
        createdBy: session.user.name || session.user.email,
        summary: `Synchronized update (v${nextVersion})`,
      },
    });

    // Record sync log
    await prisma.syncLog.create({
      data: {
        documentId,
        operation: "UPDATE",
        payload: {
          clientVersion: clientLastSyncVersion,
          serverVersion,
          mergedBlocksCount: mergedBlocks.length,
        },
        status: "COMPLETED",
      },
    });

    return NextResponse.json({
      success: true,
      document: updatedDoc,
    }, { status: 200 });
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json(
      { message: "Failed to synchronize changes" },
      { status: 500 }
    );
  }
}

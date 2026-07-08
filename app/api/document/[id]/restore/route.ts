import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const RestoreSchema = z.object({
  versionId: z.string(),
});

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

    // Check permission - must be OWNER or EDITOR to restore
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        collaborators: {
          where: { userId },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    const isOwner = document.ownerId === userId;
    const isCollab = document.collaborators.length > 0;
    const isEditor = isCollab && document.collaborators[0].role === "EDITOR";

    if (!isOwner && !isEditor) {
      return NextResponse.json(
        { message: "Only owners or editors can restore document states" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const result = RestoreSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { versionId } = result.data;

    // Find the historical version
    const versionEntry = await prisma.documentVersion.findFirst({
      where: {
        id: versionId,
        documentId,
      },
    });

    if (!versionEntry) {
      return NextResponse.json(
        { message: "Version entry not found" },
        { status: 404 }
      );
    }

    // Capture the current state as a backup snapshot first before overwriting, to allow undo
    const backupVersionNum = document.currentVersion + 1;
    await prisma.documentVersion.create({
      data: {
        documentId,
        version: backupVersionNum,
        title: document.title,
        content: document.content || {},
        createdBy: session.user.name || session.user.email,
        summary: `Pre-restore Backup (Current state before restoring v${versionEntry.version})`,
      },
    });

    // Create a new version for the restored content
    const restoredVersionNum = backupVersionNum + 1;
    const restoredVersion = await prisma.documentVersion.create({
      data: {
        documentId,
        version: restoredVersionNum,
        title: versionEntry.title,
        content: versionEntry.content || {},
        createdBy: session.user.name || session.user.email,
        summary: `Restored to version ${versionEntry.version}: "${versionEntry.title}"`,
      },
    });

    // Update document title, description, content, and currentVersion
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        content: versionEntry.content || {},
        title: versionEntry.title,
        currentVersion: restoredVersionNum,
        lastEditedBy: session.user.name || session.user.email,
        lastEditedAt: new Date(),
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        documentId,
        userId,
        action: "RESTORED",
        metadata: {
          restoredFromVersion: versionEntry.version,
          restoredToVersion: restoredVersionNum,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Document restored to version ${versionEntry.version} successfully`,
      document: updatedDocument,
    }, { status: 200 });
  } catch (error) {
    console.error("POST Restore error:", error);
    return NextResponse.json(
      { message: "Failed to restore document version" },
      { status: 500 }
    );
  }
}

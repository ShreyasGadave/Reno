import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "DELETED"]).optional(),
  isFavorite: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  content: z.any().optional(),
});

// Helper to determine user's role for a document
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
    return collab.role; // EDITOR or VIEWER
  }

  if (document.visibility === "PUBLIC") {
    return "VIEWER"; // Anyone can view public documents
  }

  return null; // No access
}

export async function GET(
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

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      document,
      role,
    }, { status: 200 });
  } catch (error) {
    console.error("GET Document error:", error);
    return NextResponse.json(
      { message: "Failed to fetch document" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    // Viewers cannot modify anything
    if (role === "VIEWER") {
      return NextResponse.json(
        { message: "Viewers cannot modify document settings" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const result = UpdateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updateData = result.data;

    // Only OWNER can change visibility or permanently archive/delete
    if (role !== "OWNER") {
      if (
        updateData.visibility !== undefined ||
        updateData.isDeleted !== undefined ||
        updateData.status !== undefined
      ) {
        return NextResponse.json(
          { message: "Only the owner can delete or change visibility" },
          { status: 403 }
        );
      }
    }

    // Word count check if content is provided
    let wordCount = undefined;
    let characterCount = undefined;
    if (updateData.content) {
      const blocks = updateData.content.blocks || [];
      let fullText = "";
      blocks.forEach((b: any) => {
        if (b.text) fullText += " " + b.text;
      });
      wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;
      characterCount = fullText.length;
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        ...updateData,
        ...(wordCount !== undefined ? { wordCount, characterCount } : {}),
        lastEditedBy: session.user.name || session.user.email,
        lastEditedAt: new Date(),
      },
    });

    // Log Activity
    let action = "UPDATED";
    if (updateData.isDeleted === true) action = "DELETED";
    else if (updateData.isArchived !== undefined) action = "UPDATED";

    await prisma.activity.create({
      data: {
        documentId,
        userId,
        action: action as any,
        metadata: {
          updatedFields: Object.keys(updateData),
        },
      },
    });

    return NextResponse.json({
      success: true,
      document: updatedDocument,
    }, { status: 200 });
  } catch (error) {
    console.error("PATCH Document error:", error);
    return NextResponse.json(
      { message: "Failed to update document" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    if (role !== "OWNER") {
      return NextResponse.json(
        { message: "Only the owner can permanently delete the document" },
        { status: 403 }
      );
    }

    // Delete associated entries first (cascade or manual delete)
    await prisma.collaboration.deleteMany({ where: { documentId } });
    await prisma.documentVersion.deleteMany({ where: { documentId } });
    await prisma.comment.deleteMany({ where: { documentId } });
    await prisma.syncLog.deleteMany({ where: { documentId } });

    await prisma.document.delete({
      where: { id: documentId },
    });

    return NextResponse.json({
      success: true,
      message: "Document permanently deleted",
    }, { status: 200 });
  } catch (error) {
    console.error("DELETE Document error:", error);
    return NextResponse.json(
      { message: "Failed to delete document" },
      { status: 500 }
    );
  }
}

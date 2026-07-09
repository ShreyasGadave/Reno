import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const AddCollaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]),
});

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

    // Check permission - must be OWNER or EDITOR to view collaborators
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        collaborators: {
          where: { userId },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ message: "Document not found" }, { status: 444 });
    }

    const isOwner = document.ownerId === userId;
    const isCollab = document.collaborators.length > 0;

    if (!isOwner && !isCollab) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const collaborators = await prisma.collaboration.findMany({
      where: { documentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      collaborators,
    }, { status: 200 });
  } catch (error) {
    console.error("GET Collaborators error:", error);
    return NextResponse.json(
      { message: "Failed to fetch collaborators" },
      { status: 500 }
    );
  }
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

    const currentUserId = session.user.id;

    // Check permission - only OWNER can add collaborators
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    if (document.ownerId !== currentUserId) {
      return NextResponse.json(
        { message: "Only the owner can add collaborators" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const result = AddCollaboratorSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, role } = result.data;

    // Find the user to collaborate with
    const targetUser = await prisma.user.findUnique({
      where: { email },
    });

    if (!targetUser) {
      return NextResponse.json(
        { message: "User with this email does not exist." },
        { status: 404 }
      );
    }

    // Check if they are already the owner
    if (document.ownerId === targetUser.id) {
      return NextResponse.json(
        { message: "User is already the owner of this document." },
        { status: 400 }
      );
    }

    // Check if collaboration already exists
    const existingCollab = await prisma.collaboration.findUnique({
      where: {
        userId_documentId: {
          userId: targetUser.id,
          documentId,
        },
      },
    });

    if (existingCollab) {
      // Update role
      const updatedCollab = await prisma.collaboration.update({
        where: { id: existingCollab.id },
        data: { role },
      });
      return NextResponse.json({
        success: true,
        message: "Collaborator privileges updated",
        collaboration: updatedCollab,
      });
    }

    // Create collaboration
    const collaboration = await prisma.collaboration.create({
      data: {
        userId: targetUser.id,
        documentId,
        role,
        invitedBy: session.user.name || session.user.email,
        accepted: true,
      },
    });

    // Update document visibility to SHARED if it was PRIVATE
    if (document.visibility === "PRIVATE") {
      await prisma.document.update({
        where: { id: documentId },
        data: { visibility: "SHARED" },
      });
    }

    // Log activity
    await prisma.activity.create({
      data: {
        documentId,
        userId: currentUserId,
        action: "SHARED",
        metadata: {
          collaboratorId: targetUser.id,
          collaboratorEmail: email,
          role,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Collaborator added successfully",
      collaboration,
    }, { status: 201 });
  } catch (error) {
    console.error("POST Collaborator error:", error);
    return NextResponse.json(
      { message: "Failed to add collaborator" },
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

    const currentUserId = session.user.id;

    // Check permission - only OWNER can remove collaborators
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    console.log("DELETE Collaborator debug:", {
      documentOwnerId: document.ownerId,
      currentUserId: currentUserId,
      areEqual: document.ownerId === currentUserId,
      userSession: session.user,
    });

    if (document.ownerId !== currentUserId) {
      return NextResponse.json(
        { message: "Only the owner can remove collaborators" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userIdToRemove = searchParams.get("userId");

    if (!userIdToRemove) {
      return NextResponse.json(
        { message: "userId parameter is required" },
        { status: 400 }
      );
    }

    await prisma.collaboration.delete({
      where: {
        userId_documentId: {
          userId: userIdToRemove,
          documentId,
        },
      },
    });

    // Check if any collaborators remain. If not, reset visibility to PRIVATE? Optionally.
    const remainingCollabs = await prisma.collaboration.count({
      where: { documentId },
    });

    if (remainingCollabs === 0 && document.visibility === "SHARED") {
      await prisma.document.update({
        where: { id: documentId },
        data: { visibility: "PRIVATE" },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Collaborator removed successfully",
    }, { status: 200 });
  } catch (error) {
    console.error("DELETE Collaborator error:", error);
    return NextResponse.json(
      { message: "Failed to remove collaborator" },
      { status: 500 }
    );
  }
}

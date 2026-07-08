import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const SnapshotSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
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

    // Check permissions
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
    const isPublic = document.visibility === "PUBLIC";

    if (!isOwner && !isCollab && !isPublic) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { version: "desc" },
    });

    return NextResponse.json({
      success: true,
      versions,
    }, { status: 200 });
  } catch (error) {
    console.error("GET Versions error:", error);
    return NextResponse.json(
      { message: "Failed to fetch version history" },
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

    const userId = session.user.id;

    // Check permission - must be OWNER or EDITOR to create a snapshot
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
        { message: "Only owners or editors can create versions" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const result = SnapshotSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { title, summary } = result.data;

    // Create the version checkpoint
    const nextVersionNum = document.currentVersion + 1;

    const documentVersion = await prisma.documentVersion.create({
      data: {
        documentId,
        version: nextVersionNum,
        title,
        content: document.content || {},
        createdBy: session.user.name || session.user.email,
        summary: summary || "Manual snapshot",
      },
    });

    // Update document's current version
    await prisma.document.update({
      where: { id: documentId },
      data: {
        currentVersion: nextVersionNum,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Snapshot version created successfully",
      version: documentVersion,
    }, { status: 201 });
  } catch (error) {
    console.error("POST Version error:", error);
    return NextResponse.json(
      { message: "Failed to create version checkpoint" },
      { status: 500 }
    );
  }
}

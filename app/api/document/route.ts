import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "all";

    let documents = [];

    if (filter === "shared") {
      // Find documents where the user is a collaborator but not the owner
      documents = await prisma.document.findMany({
        where: {
          collaborators: {
            some: {
              userId,
            },
          },
          ownerId: {
            not: userId,
          },
          isDeleted: false,
          isArchived: false,
        },
        include: {
          owner: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    } else {
      // Owned documents with specific filters
      const whereClause: any = {
        ownerId: userId,
      };

      if (filter === "favorites") {
        whereClause.isFavorite = true;
        whereClause.isDeleted = false;
        whereClause.isArchived = false;
      } else if (filter === "archive") {
        whereClause.isArchived = true;
        whereClause.isDeleted = false;
      } else if (filter === "trash") {
        whereClause.isDeleted = true;
      } else {
        // default "all" active owned documents
        whereClause.isDeleted = false;
        whereClause.isArchived = false;
      }

      documents = await prisma.document.findMany({
        where: whereClause,
        include: {
          owner: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    }

    return NextResponse.json(documents, { status: 200 });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { message: "Failed to fetch documents" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const document = await prisma.document.create({
      data: {
        title: "Untitled Document",
        description: "",
        content: { blocks: [] }, // Start with empty blocks array
        ownerId: session.user.id,
      },
    });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { message: "Failed to create document" },
      { status: 500 }
    );
  }
}


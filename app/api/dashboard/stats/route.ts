import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Total active owned documents
    const totalOwned = await prisma.document.count({
      where: {
        ownerId: userId,
        isDeleted: false,
        isArchived: false,
      },
    });

    // 2. Shared with me documents
    const sharedWithMe = await prisma.collaboration.count({
      where: {
        userId: userId,
        document: {
          isDeleted: false,
          isArchived: false,
        },
        role: {
          not: "OWNER",
        },
      },
    });

    // 3. Favorites
    const favorites = await prisma.document.count({
      where: {
        ownerId: userId,
        isFavorite: true,
        isDeleted: false,
        isArchived: false,
      },
    });

    // 4. Archived
    const archived = await prisma.document.count({
      where: {
        ownerId: userId,
        isArchived: true,
        isDeleted: false,
      },
    });

    // 5. Trash
    const trash = await prisma.document.count({
      where: {
        ownerId: userId,
        isDeleted: true,
      },
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalOwned,
        sharedWithMe,
        favorites,
        archived,
        trash,
      },
    }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return NextResponse.json(
      { message: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: session.user,
    });
  } catch (error) {
    return NextResponse.json({ message: "Failed to fetch user session" }, { status: 500 });
  }
}

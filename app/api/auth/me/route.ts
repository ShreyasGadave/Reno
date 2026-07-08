import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

import jwt from "jsonwebtoken";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const response = NextResponse.json({
      success: true,
      user: session.user,
    });

    // Refresh token expiry (sliding session refresh)
    const newToken = jwt.sign(
      { id: session.user.id, email: session.user.email, name: session.user.name },
      process.env.JWT_SECRET!,
      { expiresIn: "15m" }
    );

    response.cookies.set({
      name: "token",
      value: newToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60, // 15 minutes
    });

    return response;
  } catch (error) {
    return NextResponse.json({ message: "Failed to fetch user session" }, { status: 500 });
  }
}

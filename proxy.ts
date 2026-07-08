import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const pathname = request.nextUrl.pathname;

  const authPages = ["/signin", "/signup"];
  const protectedPages = [
    "/dashboard",
    "/trash",
    "/favorites",
    "/shared",
    "/document",
    "/archive",
  ];

  const isAuthPage = authPages.includes(pathname);
  const isProtectedPage = protectedPages.some((page) => pathname.startsWith(page));

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string; email: string; name?: string };

      // Already logged in → redirect auth pages to dashboard
      if (isAuthPage) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }

      // Extend token expiry (sliding session refresh)
      const newToken = jwt.sign(
        { id: decoded.id, email: decoded.email, name: decoded.name },
        process.env.JWT_SECRET!,
        { expiresIn: "15m" }
      );

      const response = NextResponse.next();
      response.cookies.set({
        name: "token",
        value: newToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 15 * 60, // 15 minutes fresh duration
      });

      return response;
    } catch {
      // Invalid or expired token → fall through to clean and redirect
    }
  }

  // Not logged in → redirect protected pages to signin page
  if (isProtectedPage) {
    const response = NextResponse.redirect(new URL("/signin", request.url));
    response.cookies.delete("token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/signin",
    "/signup",
    "/dashboard/:path*",
    "/document/:path*",
    "/shared/:path*",
    "/favorites/:path*",
    "/archive/:path*",
    "/trash/:path*",
  ],
};

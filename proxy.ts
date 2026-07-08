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

  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET!);

      // Already logged in → don't allow auth pages
      if (authPages.includes(pathname)) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }

      return NextResponse.next();
    } catch {
      // Invalid or expired token → fall through to unauthenticated handling below
    }
  }

  // Not logged in → protect private pages
  if (protectedPages.some((page) => pathname.startsWith(page))) {
    return NextResponse.redirect(new URL("/signin", request.url));
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

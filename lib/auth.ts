import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthSession {
  user: AuthUser;
}

export async function auth(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get("token")?.value;

    if (!token) {
      return null;
    }

    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET!
    ) as AuthUser;

    return {
      user: {
        id: payload.id,
        email: payload.email,
        name: payload.name,
      },
    };
  } catch (error) {
    return null;
  }
}
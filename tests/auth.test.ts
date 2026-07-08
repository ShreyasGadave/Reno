import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "4oeymO7vw5GWgDJe";

describe("DocFlow Authentication Verification", () => {
  it("should successfully sign and verify a user JWT token", () => {
    const payload = { id: "test_user_1", email: "verify@docflow.com" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
    
    expect(token).toBeDefined();
    
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    expect(decoded.id).toBe("test_user_1");
    expect(decoded.email).toBe("verify@docflow.com");
  });

  it("should reject token verification if JWT signature is tampered", () => {
    const payload = { id: "test_user_1", email: "verify@docflow.com" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
    const tampered = token + "abc"; // tamper the signature

    expect(() => {
      jwt.verify(tampered, JWT_SECRET);
    }).toThrow();
  });

  it("should reject verification when secret key mismatches", () => {
    const payload = { id: "test_user_1", email: "verify@docflow.com" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
    const WRONG_SECRET = "wrong_secret_key_123";

    expect(() => {
      jwt.verify(token, WRONG_SECRET);
    }).toThrow();
  });

  it("should expire tokens correctly and throw TokenExpiredError", () => {
    const payload = { id: "test_user_1", email: "verify@docflow.com" };
    // Sign an expired token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "-1s" });

    expect(() => {
      jwt.verify(token, JWT_SECRET);
    }).toThrow();
  });
});

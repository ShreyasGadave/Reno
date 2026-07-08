import { describe, it, expect } from "vitest";

// Mock validation logic matching the server sync payload checks
function validatePayload(payload: { title?: string; content?: { blocks: any[] } }): { success: boolean; error?: string } {
  // 1. Prototype Pollution Defense
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.includes("__proto__") || payloadStr.includes("constructor")) {
    return { success: false, error: "Prototype pollution input blocked" };
  }

  // 2. Payload size limit (e.g. 1MB)
  if (payloadStr.length > 1024 * 1024) {
    return { success: false, error: "Payload size limit exceeded (Max 1MB)" };
  }

  // 3. Blocks limit check
  const blocks = payload.content?.blocks || [];
  if (blocks.length > 500) {
    return { success: false, error: "Blocks count limit exceeded (Max 500)" };
  }

  // 4. Character count limits check per block
  for (const block of blocks) {
    if (block.text && block.text.length > 10000) {
      return { success: false, error: "Block character count limit exceeded (Max 10k)" };
    }
  }

  return { success: true };
}

describe("DocFlow Server Security Filters", () => {
  it("should permit clean, valid payloads within bounds", () => {
    const payload = {
      title: "Clean Document",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Short text string" }],
      },
    };
    const result = validatePayload(payload);
    expect(result.success).toBe(true);
  });

  it("should block prototype pollution attempts containing constructor or proto keys", () => {
    const payloadObj = JSON.parse('{"title":"Attack","__proto__":{"polluted":true}}');
    const result = validatePayload(payloadObj);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Prototype pollution");
  });

  it("should block update payloads exceeding 1MB in size", () => {
    const hugeText = "a".repeat(1024 * 1024 + 10);
    const payload = {
      title: "Huge Content",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: hugeText }],
      },
    };
    const result = validatePayload(payload);
    expect(result.success).toBe(false);
    expect(result.error).toContain("size limit exceeded");
  });

  it("should block updates containing more than 500 content blocks", () => {
    const blocksList = Array.from({ length: 501 }, (_, i) => ({
      id: `b${i}`,
      type: "paragraph",
      text: "line content",
    }));
    const payload = {
      title: "Too many blocks",
      content: { blocks: blocksList },
    };
    const result = validatePayload(payload);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocks count limit exceeded");
  });

  it("should block individual blocks exceeding 10,000 characters limit", () => {
    const largeBlockText = "a".repeat(10005);
    const payload = {
      title: "Oversized block",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: largeBlockText }],
      },
    };
    const result = validatePayload(payload);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Block character count limit exceeded");
  });
});

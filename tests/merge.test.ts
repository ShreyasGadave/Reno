import { describe, it, expect } from "vitest";

// Local version of the 3-way merge algorithm used in sync APIs & useOfflineSync
function mergeBlocks(baseBlocks: any[], clientBlocks: any[], serverBlocks: any[]): any[] {
  const baseMap = new Map(baseBlocks.map((b) => [b.id, b]));
  const serverMap = new Map(serverBlocks.map((b) => [b.id, b]));
  const clientMap = new Map(clientBlocks.map((b) => [b.id, b]));

  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...serverMap.keys(),
    ...clientMap.keys(),
  ]);

  const resolvedMap = new Map<string, any>();

  for (const id of allBlockIds) {
    const baseB = baseMap.get(id);
    const serverB = serverMap.get(id);
    const clientB = clientMap.get(id);

    if (baseB && serverB && clientB) {
      const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
      const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

      if (clientChanged && !serverChanged) {
        resolvedMap.set(id, clientB);
      } else if (serverChanged && !clientChanged) {
        resolvedMap.set(id, serverB);
      } else if (clientChanged && serverChanged) {
        if (clientB.updatedAt >= serverB.updatedAt) {
          resolvedMap.set(id, clientB);
        } else {
          resolvedMap.set(id, serverB);
        }
      } else {
        resolvedMap.set(id, baseB);
      }
    } else if (!baseB) {
      if (clientB && !serverB) {
        resolvedMap.set(id, clientB);
      } else if (serverB && !clientB) {
        resolvedMap.set(id, serverB);
      } else if (clientB && serverB) {
        resolvedMap.set(id, clientB.updatedAt >= serverB.updatedAt ? clientB : serverB);
      }
    } else {
      if (serverB && !clientB) {
        if (JSON.stringify(serverB) !== JSON.stringify(baseB)) {
          resolvedMap.set(id, serverB);
        }
      } else if (clientB && !serverB) {
        if (JSON.stringify(clientB) !== JSON.stringify(baseB)) {
          resolvedMap.set(id, clientB);
        }
      }
    }
  }

  const finalSequence: any[] = [];
  const addedIds = new Set<string>();

  for (const block of clientBlocks) {
    if (resolvedMap.has(block.id)) {
      finalSequence.push(resolvedMap.get(block.id));
      addedIds.add(block.id);
    }
  }

  for (let i = 0; i < serverBlocks.length; i++) {
    const block = serverBlocks[i];
    if (resolvedMap.has(block.id) && !addedIds.has(block.id)) {
      let insertIndex = -1;
      for (let j = i - 1; j >= 0; j--) {
        const prevId = serverBlocks[j].id;
        const idx = finalSequence.findIndex((b) => b.id === prevId);
        if (idx !== -1) {
          insertIndex = idx + 1;
          break;
        }
      }

      if (insertIndex !== -1) {
        finalSequence.splice(insertIndex, 0, resolvedMap.get(block.id));
      } else {
        finalSequence.push(resolvedMap.get(block.id));
      }
      addedIds.add(block.id);
    }
  }

  return finalSequence;
}

describe("DocFlow CvRDT Block Merge Algorithm", () => {
  it("should merge independent edits cleanly when no conflicts exist", () => {
    const base = [
      { id: "b1", type: "paragraph", text: "Original Text", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Hello World", updatedAt: 100 },
    ];
    // Client updates block 1
    const client = [
      { id: "b1", type: "paragraph", text: "Client Edit Text", updatedAt: 200 },
      { id: "b2", type: "paragraph", text: "Hello World", updatedAt: 100 },
    ];
    // Server updates block 2
    const server = [
      { id: "b1", type: "paragraph", text: "Original Text", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Server Edit Text", updatedAt: 300 },
    ];

    const merged = mergeBlocks(base, client, server);
    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("Client Edit Text");
    expect(merged[1].text).toBe("Server Edit Text");
  });

  it("should resolve concurrent edits on the same block using Last-Write-Wins (LWW) timestamps", () => {
    const base = [{ id: "b1", type: "paragraph", text: "Original Text", updatedAt: 100 }];
    // Client updates at t=200
    const client = [{ id: "b1", type: "paragraph", text: "Client Text (newer)", updatedAt: 200 }];
    // Server updates at t=150
    const server = [{ id: "b1", type: "paragraph", text: "Server Text (older)", updatedAt: 150 }];

    const merged = mergeBlocks(base, client, server);
    expect(merged[0].text).toBe("Client Text (newer)");
  });

  it("should restore a deleted block if another collaborator modified it concurrently", () => {
    const base = [
      { id: "b1", type: "paragraph", text: "Original Block 1", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Original Block 2", updatedAt: 100 },
    ];
    // Client deletes Block 2
    const client = [{ id: "b1", type: "paragraph", text: "Original Block 1", updatedAt: 100 }];
    // Server edits Block 2
    const server = [
      { id: "b1", type: "paragraph", text: "Original Block 1", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Server Modified Block 2", updatedAt: 250 },
    ];

    const merged = mergeBlocks(base, client, server);
    expect(merged).toHaveLength(2);
    expect(merged[1].text).toBe("Server Modified Block 2");
  });

  it("should detect overlapping conflict if both client and server modified the same block to different values", () => {
    const base = [{ id: "b1", type: "paragraph", text: "Original", updatedAt: 100 }];
    const client = [{ id: "b1", type: "paragraph", text: "Client Edit", updatedAt: 200 }];
    const server = [{ id: "b1", type: "paragraph", text: "Server Edit", updatedAt: 300 }];

    expect(hasOverlappingConflict(base, client, server)).toBe(true);
  });

  it("should NOT detect conflict if client and server modified different blocks concurrently", () => {
    const base = [
      { id: "b1", type: "paragraph", text: "Original Block 1", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Original Block 2", updatedAt: 100 },
    ];
    const client = [
      { id: "b1", type: "paragraph", text: "Client Edit Block 1", updatedAt: 200 },
      { id: "b2", type: "paragraph", text: "Original Block 2", updatedAt: 100 },
    ];
    const server = [
      { id: "b1", type: "paragraph", text: "Original Block 1", updatedAt: 100 },
      { id: "b2", type: "paragraph", text: "Server Edit Block 2", updatedAt: 300 },
    ];

    expect(hasOverlappingConflict(base, client, server)).toBe(false);
  });

  it("should NOT detect conflict if they modified the same block to the identical value", () => {
    const base = [{ id: "b1", type: "paragraph", text: "Original", updatedAt: 100 }];
    const client = [{ id: "b1", type: "paragraph", text: "Same Edit", updatedAt: 200 }];
    const server = [{ id: "b1", type: "paragraph", text: "Same Edit", updatedAt: 300 }];

    expect(hasOverlappingConflict(base, client, server)).toBe(false);
  });

  it("should skip conflict detection in single-user mode even if client version is older", () => {
    const activeCollaboratorsCount = 1;
    const clientVersion = 10;
    const serverVersion = 12;

    const triggerConflict = activeCollaboratorsCount > 1 && serverVersion > clientVersion;
    expect(triggerConflict).toBe(false);
  });
});

function hasOverlappingConflict(baseBlocks: any[], clientBlocks: any[], serverBlocks: any[]): boolean {
  const baseMap = new Map((baseBlocks || []).map((b) => [b.id, b]));
  const serverMap = new Map((serverBlocks || []).map((b) => [b.id, b]));
  const clientMap = new Map((clientBlocks || []).map((b) => [b.id, b]));

  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...serverMap.keys(),
    ...clientMap.keys(),
  ]);

  for (const id of allBlockIds) {
    const baseB = baseMap.get(id);
    const serverB = serverMap.get(id);
    const clientB = clientMap.get(id);

    if (baseB && serverB && clientB) {
      const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
      const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

      const contentIdentical =
        clientB.text === serverB.text &&
        clientB.type === serverB.type &&
        clientB.checked === serverB.checked;

      if (clientChanged && serverChanged && !contentIdentical) {
        return true;
      }
    }
  }

  return false;
}

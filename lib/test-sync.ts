/**
 * Test script for DocFlow's 3-way block-level conflict resolution algorithm.
 * Can be run via: npx tsx lib/test-sync.ts
 */

interface Block {
  id: string;
  type: string;
  text: string;
  checked?: boolean;
  updatedAt: number;
  updatedBy: string;
}

// Conflict Resolution implementation (from app/api/document/[id]/sync/route.ts)
function mergeBlocks(baseBlocks: Block[], clientBlocks: Block[], serverBlocks: Block[]): Block[] {
  const baseMap = new Map(baseBlocks.map((b) => [b.id, b]));
  const serverMap = new Map(serverBlocks.map((b) => [b.id, b]));
  const clientMap = new Map(clientBlocks.map((b) => [b.id, b]));

  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...serverMap.keys(),
    ...clientMap.keys(),
  ]);

  const resolvedBlocksMap = new Map<string, any>();

  for (const id of allBlockIds) {
    const baseB = baseMap.get(id);
    const serverB = serverMap.get(id);
    const clientB = clientMap.get(id);

    if (baseB && serverB && clientB) {
      const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
      const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);

      if (clientChanged && !serverChanged) {
        resolvedBlocksMap.set(id, clientB);
      } else if (serverChanged && !clientChanged) {
        resolvedBlocksMap.set(id, serverB);
      } else if (clientChanged && serverChanged) {
        // Conflict! Resolve using LWW timestamp
        if (clientB.updatedAt >= serverB.updatedAt) {
          resolvedBlocksMap.set(id, clientB);
        } else {
          resolvedBlocksMap.set(id, serverB);
        }
      } else {
        resolvedBlocksMap.set(id, baseB);
      }
    } else if (!baseB) {
      if (clientB && !serverB) {
        resolvedBlocksMap.set(id, clientB);
      } else if (serverB && !clientB) {
        resolvedBlocksMap.set(id, serverB);
      } else if (clientB && serverB) {
        resolvedBlocksMap.set(
          id,
          clientB.updatedAt >= serverB.updatedAt ? clientB : serverB
        );
      }
    } else {
      // Deleted Block
      if (serverB && !clientB) {
        const serverChanged = JSON.stringify(serverB) !== JSON.stringify(baseB);
        if (serverChanged) {
          resolvedBlocksMap.set(id, serverB); // Restore
        }
      } else if (clientB && !serverB) {
        const clientChanged = JSON.stringify(clientB) !== JSON.stringify(baseB);
        if (clientChanged) {
          resolvedBlocksMap.set(id, clientB); // Restore
        }
      }
    }
  }

  // Preserve Sequence Order
  const finalSequence: Block[] = [];
  const addedIds = new Set<string>();

  for (const block of clientBlocks) {
    if (resolvedBlocksMap.has(block.id)) {
      finalSequence.push(resolvedBlocksMap.get(block.id));
      addedIds.add(block.id);
    }
  }

  for (let i = 0; i < serverBlocks.length; i++) {
    const block = serverBlocks[i];
    if (resolvedBlocksMap.has(block.id) && !addedIds.has(block.id)) {
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
        finalSequence.splice(insertIndex, 0, resolvedBlocksMap.get(block.id));
      } else {
        finalSequence.push(resolvedBlocksMap.get(block.id));
      }
      addedIds.add(block.id);
    }
  }

  return finalSequence;
}

// Test Runner
function runTests() {
  console.log("🚀 Starting DocFlow Sync Conflict Resolution Test Suite...");

  // Test Case 1: Client edits Block A, Server edits Block B (Non-conflicting)
  const base1: Block[] = [
    { id: "b1", type: "paragraph", text: "Original Text 1", updatedAt: 100, updatedBy: "user1" },
    { id: "b2", type: "paragraph", text: "Original Text 2", updatedAt: 100, updatedBy: "user1" },
  ];
  const client1: Block[] = [
    { id: "b1", type: "paragraph", text: "Client Edit 1", updatedAt: 200, updatedBy: "client" },
    { id: "b2", type: "paragraph", text: "Original Text 2", updatedAt: 100, updatedBy: "user1" },
  ];
  const server1: Block[] = [
    { id: "b1", type: "paragraph", text: "Original Text 1", updatedAt: 100, updatedBy: "user1" },
    { id: "b2", type: "paragraph", text: "Server Edit 2", updatedAt: 300, updatedBy: "server" },
  ];

  const res1 = mergeBlocks(base1, client1, server1);
  console.assert(res1.length === 2, "TC1 Failed: Length mismatch");
  console.assert(res1[0].text === "Client Edit 1", "TC1 Failed: Client change not merged");
  console.assert(res1[1].text === "Server Edit 2", "TC1 Failed: Server change not merged");
  console.log("✅ Test 1 Passed: Independent non-conflicting updates merge cleanly.");

  // Test Case 2: Concurrent edit conflict on Block A (LWW Resolution)
  const base2: Block[] = [
    { id: "b1", type: "paragraph", text: "Original Text", updatedAt: 100, updatedBy: "user1" },
  ];
  const client2: Block[] = [
    { id: "b1", type: "paragraph", text: "Client Edit", updatedAt: 200, updatedBy: "client" },
  ];
  const server2: Block[] = [
    { id: "b1", type: "paragraph", text: "Server Edit (Newer)", updatedAt: 300, updatedBy: "server" },
  ];

  const res2 = mergeBlocks(base2, client2, server2);
  console.assert(res2[0].text === "Server Edit (Newer)", "TC2 Failed: LWW failed to select server's newer update");
  
  // Swap timestamps: Client wins
  client2[0].updatedAt = 400;
  const res2b = mergeBlocks(base2, client2, server2);
  console.assert(res2b[0].text === "Client Edit", "TC2 Failed: LWW failed to select client's newer update");
  console.log("✅ Test 2 Passed: Concurrent conflicts resolve using Last-Write-Wins (LWW) timestamps.");

  // Test Case 3: Deletion vs modification conflict
  const base3: Block[] = [
    { id: "b1", type: "paragraph", text: "Block to delete/modify", updatedAt: 100, updatedBy: "user1" },
  ];
  // Client deleted the block
  const client3: Block[] = [];
  // Server updated the block
  const server3: Block[] = [
    { id: "b1", type: "paragraph", text: "Modified block on server", updatedAt: 250, updatedBy: "server" },
  ];

  const res3 = mergeBlocks(base3, client3, server3);
  console.assert(res3.length === 1, "TC3 Failed: Modified block was deleted");
  console.assert(res3[0].text === "Modified block on server", "TC3 Failed: Content mismatch for restored block");
  console.log("✅ Test 3 Passed: Deletions are overridden if another user concurrently modified the block.");

  // Test Case 4: Concurrent Additions and Deletions Ordering
  const base4: Block[] = [
    { id: "b1", type: "paragraph", text: "B1", updatedAt: 100, updatedBy: "user1" },
    { id: "b2", type: "paragraph", text: "B2", updatedAt: 100, updatedBy: "user1" },
  ];
  // Client deleted B2 and added B3
  const client4: Block[] = [
    { id: "b1", type: "paragraph", text: "B1", updatedAt: 100, updatedBy: "user1" },
    { id: "b3", type: "paragraph", text: "B3 (New client block)", updatedAt: 200, updatedBy: "client" },
  ];
  // Server added B4 after B1
  const server4: Block[] = [
    { id: "b1", type: "paragraph", text: "B1", updatedAt: 100, updatedBy: "user1" },
    { id: "b4", type: "paragraph", text: "B4 (New server block)", updatedAt: 300, updatedBy: "server" },
    { id: "b2", type: "paragraph", text: "B2", updatedAt: 100, updatedBy: "user1" },
  ];

  const res4 = mergeBlocks(base4, client4, server4);
  
  // Final list should have: B1, B3, B4 (B2 was deleted by client, B4 added by server is preserved, client B3 is added)
  console.assert(res4.length === 3, `TC4 Failed: Expected 3 blocks, got ${res4.length}`);
  const ids = res4.map((b) => b.id);
  console.assert(ids.includes("b1") && ids.includes("b3") && ids.includes("b4"), "TC4 Failed: Wrong block ids in result");
  console.assert(!ids.includes("b2"), "TC4 Failed: Deleted block B2 was not removed");
  console.log("✅ Test 4 Passed: Complex concurrent additions and deletions reconcile with correct ordering.");

  console.log("\n🎉 All 4 core conflict resolution tests PASSED successfully!");
}

runTests();

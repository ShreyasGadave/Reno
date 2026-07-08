# Test Plan & Verification Matrix

This document outlines the testing strategy, test suites, and instructions for verifying the DocFlow real-time collaborative document editor.

---

## 🧪 Testing Strategy

DocFlow integrates **Vitest** for unit and integration testing. Tests execute in a light Node.js context with isolated mock adapters, making them extremely fast and suitable for continuous integration (CI) workflows.

### Execution Command
```bash
npm run test
```

---

## 📂 Test Suites Layout

All automated test suites are located in the `tests/` directory:

| Test File | Testing Scope | Scenarios Verified |
| :--- | :--- | :--- |
| [auth.test.ts](file:///Users/dhanush___777/Downloads/reno/tests/auth.test.ts) | Authentication | - Successful JWT token signing and validation.<br>- Token signature tampering rejection.<br>- Secret key mismatch verification failures.<br>- Expired token invalidation. |
| [role.test.ts](file:///Users/dhanush___777/Downloads/reno/tests/role.test.ts) | Role Authorization (RBAC) | - OWNER: Full access to read, edit, share, and delete.<br>- EDITOR: Access to read and edit content; no deletion or sharing permissions.<br>- VIEWER: Access to read only; all write operations blocked. |
| [merge.test.ts](file:///Users/dhanush___777/Downloads/reno/tests/merge.test.ts) | 3-Way CvRDT Merge & Conflicts | - Merging non-conflicting edits cleanly.<br>- Last-Write-Wins (LWW) resolution for concurrent modifications on same block.<br>- Restoring a deleted block if another user modified it concurrently.<br>- Detecting overlapping conflicts when users edit same block to different text.<br>- Bypassing conflict popups when changes are non-overlapping or identical. |
| [queue.test.ts](file:///Users/dhanush___777/Downloads/reno/tests/queue.test.ts) | Operations Queue | - FIFO queue sorting order by operation epoch timestamps.<br>- Dequeuing operations correctly after network persistence updates.<br>- Clearing local sync queue caches. |
| [security.test.ts](file:///Users/dhanush___777/Downloads/reno/tests/security.test.ts) | Security & DDoS Filters | - Blocking Prototype Pollution payloads (`__proto__`, `constructor`).<br>- Rejecting payloads exceeding 1MB maximum size.<br>- Rejecting updates exceeding 500 maximum blocks.<br>- Rejecting blocks exceeding 10,000 maximum characters. |

---

## 📈 Verification Outputs

Running `npm run test` executes all suites synchronously. The current benchmark results are:

```bash
> reno@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/dhanush___777/Downloads/reno

 ✓ tests/role.test.ts (3 tests) 3ms
 ✓ tests/queue.test.ts (3 tests) 4ms
 ✓ tests/merge.test.ts (6 tests) 5ms
 ✓ tests/security.test.ts (5 tests) 7ms
 ✓ tests/auth.test.ts (4 tests) 7ms

 Test Files  5 passed (5)
      Tests  21 passed (21)
   Start at  19:58:39
   Duration  326ms
```
All 21 scenarios across the 5 test suites pass successfully.

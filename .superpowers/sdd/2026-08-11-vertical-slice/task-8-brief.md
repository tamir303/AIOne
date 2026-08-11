# Task 8: Root monorepo integration and first build

**Files:**
- Verify: root `package.json` (created in Task 1, no changes needed)
- Verify: root `tsconfig.json` (created in Task 1, no changes needed)

**Interfaces:**
- Consumes: All previous tasks (Tasks 1-7)
- Produces: Working monorepo that builds end to end

---

## Steps

- [ ] **Step 1: Verify root package.json has workspace scripts**

The root package.json was already created in Task 1. Verify it has the following scripts:
- `build`: pnpm -r build
- `dev`: pnpm -r --parallel dev
- `lint`: pnpm -r lint
- `test`: pnpm -r test
- `type-check`: pnpm -r type-check

And verify it includes all these devDependencies:
- @typescript-eslint/eslint-plugin ^7.0.0
- @typescript-eslint/parser ^7.0.0
- eslint ^8.0.0
- prettier ^3.0.0
- typescript ^5.3.0

- [ ] **Step 2: Verify root tsconfig.json is present**

The root tsconfig.json was already created in Task 1. Verify it has:
- target: ES2022
- module: ESNext
- strict: true
- include: packages/*/src/**, apps/*/src/**

- [ ] **Step 3: Install dependencies for all packages**

```bash
pnpm install
```

Expected: All packages (core, utils, db, worker, api, web) install dependencies successfully.

- [ ] **Step 4: Build all packages**

```bash
pnpm build
```

Expected: All 6 packages build successfully with no TypeScript errors.
- packages/core build
- packages/utils build
- packages/db build
- apps/worker build
- apps/api build
- apps/web build

- [ ] **Step 5: Verify build artifacts**

Check that each package has a dist/ directory:
- packages/core/dist/ exists
- packages/utils/dist/ exists
- packages/db/dist/ exists
- apps/worker/dist/ exists
- apps/api/dist/ exists
- apps/web/dist/ exists (contains index.html and assets)

- [ ] **Step 6: Type check all packages**

```bash
pnpm type-check
```

Expected: No TypeScript errors across all packages.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete vertical slice - monorepo, schema, gate, API, web"
```

Report status: DONE or DONE_WITH_CONCERNS or BLOCKED with build output.

If all packages build clean with no errors and type-check passes, the vertical slice is complete.

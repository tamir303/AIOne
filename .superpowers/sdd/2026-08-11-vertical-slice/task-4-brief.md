# Task 4: Shared utilities package

**Files:**
- Create: `packages/utils/package.json`
- Create: `packages/utils/tsconfig.json`
- Create: `packages/utils/src/logger.ts`
- Create: `packages/utils/src/errors.ts`
- Create: `packages/utils/src/index.ts`

**Interfaces:**
- Produces: `@aione/utils` package with logger and error handling

- [ ] **Step 1: Create utils package.json**

Create `packages/utils/package.json`:
```json
{
  "name": "@aione/utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create utils tsconfig**

Create `packages/utils/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create logger**

Create `packages/utils/src/logger.ts`:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  constructor(private context: string = 'aione') {}

  log(level: LogLevel, message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()} [${this.context}]`;
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`${prefix} ${message}${payload}`);
  }

  debug(message: string, data?: Record<string, any>) {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, any>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | Record<string, any>) {
    if (error instanceof Error) {
      this.log('error', message, { message: error.message, stack: error.stack });
    } else {
      this.log('error', message, error);
    }
  }
}

export function createLogger(context?: string): Logger {
  return new Logger(context);
}
```

- [ ] **Step 4: Create error classes**

Create `packages/utils/src/errors.ts`:
```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class GateError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('GATE_ERROR', message, 403, details);
    this.name = 'GateError';
  }
}
```

- [ ] **Step 5: Export from index**

Create `packages/utils/src/index.ts`:
```typescript
export { createLogger, type LogLevel } from './logger';
export { AppError, ValidationError, NotFoundError, UnauthorizedError, GateError } from './errors';
```

- [ ] **Step 6: Build and commit**

```bash
cd packages/utils
pnpm install
pnpm build
cd ../..
git add packages/utils/
git commit -m "feat: shared utilities (logger, errors)"
```

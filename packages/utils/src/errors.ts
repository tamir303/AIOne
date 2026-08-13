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

export class EgressDeniedError extends AppError {
  constructor(host: string, details?: Record<string, any>) {
    super(
      'EGRESS_DENIED',
      `Egress to "${host}" is denied: sandbox egress is default-deny and this host is not on the allowlist`,
      403,
      details,
    );
    this.name = 'EgressDeniedError';
  }
}

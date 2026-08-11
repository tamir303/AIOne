export class ApprovalToken {
  private constructor(readonly runId: string, readonly timestamp: number) {}

  static create(runId: string): ApprovalToken {
    return new ApprovalToken(runId, Date.now());
  }

  static isValid(token: unknown): token is ApprovalToken {
    return token instanceof ApprovalToken;
  }
}

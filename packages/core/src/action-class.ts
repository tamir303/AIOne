export type ActionClass =
  | 'read'
  | 'file_write'
  | 'terminal_read'
  | 'terminal_mutating'
  | 'git_local'
  | 'push'
  | 'merge'
  | 'registry_push'
  | 'deploy'
  | 'destructive';

export function classifyAction(action: {
  type: string;
  command?: string;
  details?: Record<string, any>;
}): ActionClass {
  const { type } = action;

  switch (type) {
    case 'read':
      return 'read';
    case 'file_write':
      return 'file_write';
    case 'terminal_read':
      return 'terminal_read';
    case 'git_commit':
      return 'git_local';
    case 'git_push':
      return 'push';
    case 'git_merge':
      return 'merge';
    case 'registry_push':
      return 'registry_push';
    case 'deploy':
      return 'deploy';
    default:
      return 'destructive';
  }
}

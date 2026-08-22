export class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

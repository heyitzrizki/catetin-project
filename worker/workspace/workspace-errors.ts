/**
 * Definisi galat domain terstruktur untuk ruang kerja cloud Catetin.
 * Memastikan tidak ada stack trace, kueri SQL internal, atau keberadaan
 * resource lintas-ruang-kerja yang bocor ke respons publik.
 */

export type WorkspaceErrorCode =
  | 'UNAUTHORIZED'
  | 'WORKSPACE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'LAST_OWNER_REQUIRED'
  | 'INVALID_SYNC_CURSOR'
  | 'INVALID_MUTATION_PLAN'
  | 'FULL_RESYNC_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'INTERNAL_OPERATION_FAILED'
  | 'METHOD_NOT_ALLOWED';

export interface StructuredErrorResponse {
  error: {
    code: WorkspaceErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class WorkspaceDomainError extends Error {
  public readonly code: WorkspaceErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: WorkspaceErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkspaceDomainError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, WorkspaceDomainError.prototype);
  }

  public toResponse(): StructuredErrorResponse {
    const res: StructuredErrorResponse = {
      error: {
        code: this.code,
        message: this.message,
      },
    };
    if (this.details && Object.keys(this.details).length > 0) {
      res.error.details = this.details;
    }
    return res;
  }
}

/**
 * Mengonversi galat sembarang menjadi respons galat domain terstruktur yang aman.
 */
export function formatDomainError(err: unknown): { status: number; body: StructuredErrorResponse } {
  if (err instanceof WorkspaceDomainError) {
    return {
      status: err.status,
      body: err.toResponse(),
    };
  }

  // Galat tak terduga disanitasi agar tidak membocorkan pesan internal atau SQL
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_OPERATION_FAILED',
        message: 'Terjadi kesalahan internal pada server ruang kerja',
      },
    },
  };
}

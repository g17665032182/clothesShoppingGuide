export const STRUCTURED_TEXT_GENERATION_PORT = Symbol(
  'STRUCTURED_TEXT_GENERATION_PORT',
);

export type StructuredTextGenerationInput = {
  system: string;
  user: string;
  timeoutMs: number;
};

export type StructuredTextGenerationResult = {
  model: string;
  content: string;
};

export type StructuredTextGenerationErrorCode =
  | 'MODEL_TIMEOUT'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_OUTPUT';

export class StructuredTextGenerationError extends Error {
  public constructor(public readonly code: StructuredTextGenerationErrorCode) {
    super(code);
    this.name = 'StructuredTextGenerationError';
  }
}

export interface StructuredTextGenerationPort {
  generate(
    input: StructuredTextGenerationInput,
  ): Promise<StructuredTextGenerationResult>;
}

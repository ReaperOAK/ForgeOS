/**
 * Test stub for middleware/logging module.
 *
 * Provides a no-op pino-compatible logger and express middleware stub
 * for use as a vitest resolve alias when the real middleware module
 * has not yet been implemented.
 *
 * @module __tests__/__mocks__/logging
 * @ticket TASK-FOS-01-002 (QA infrastructure)
 */

import type { Request, Response, NextFunction } from 'express';

export const logger = {
  info: (..._args: unknown[]): void => {},
  warn: (..._args: unknown[]): void => {},
  error: (..._args: unknown[]): void => {},
  debug: (..._args: unknown[]): void => {},
  fatal: (..._args: unknown[]): void => {},
  trace: (..._args: unknown[]): void => {},
  child: () => logger,
};

export const requestLogger = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

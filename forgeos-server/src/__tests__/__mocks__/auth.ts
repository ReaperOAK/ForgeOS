/**
 * Test stub for middleware/auth module.
 *
 * Provides a pass-through auth middleware stub for use as a vitest
 * resolve alias when the real middleware module has not yet been
 * implemented.
 *
 * @module __tests__/__mocks__/auth
 * @ticket TASK-FOS-01-002 (QA infrastructure)
 */

import type { Request, Response, NextFunction } from 'express';

export const authMiddleware = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

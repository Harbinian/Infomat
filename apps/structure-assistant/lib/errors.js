'use strict';

class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(500, 'INTERNAL_ERROR', '服务暂时无法完成本次操作。');
}

module.exports = {
  AppError,
  asAppError
};

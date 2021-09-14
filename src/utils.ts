import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

type ErrorHandlerFn = (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export const combineErrorHandlers =
  (errorHandlers: ErrorHandlerFn[]): ErrorHandlerFn =>
  (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    errorHandlers.forEach(handler => handler(error, req, reply));
  };

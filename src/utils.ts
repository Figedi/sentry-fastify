import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

type ErrorHandlerFn = (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export const combineErrorHandlers =
  (errorHandlers: ErrorHandlerFn[]): ErrorHandlerFn =>
  (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    errorHandlers.forEach(handler => handler(error, req, reply));
  };

export const isUuidV4 = (uuid: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);

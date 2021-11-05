import { TRACEPARENT_REGEXP } from "@sentry/tracing";
import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

type ErrorHandlerFn = (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export const combineErrorHandlers =
  (errorHandlers: ErrorHandlerFn[]): ErrorHandlerFn =>
  (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    errorHandlers.forEach(handler => handler(error, req, reply));
  };

export const isSentryUuid4 = (uuid: string): boolean => TRACEPARENT_REGEXP.test(uuid);

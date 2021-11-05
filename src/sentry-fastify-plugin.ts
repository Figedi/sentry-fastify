/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { captureException as sentryCapture, getCurrentHub, startTransaction, withScope } from "@sentry/core";
import { extractTraceparentData, Span } from "@sentry/tracing";
import { Event, RequestSessionStatus, Transaction } from "@sentry/types";
import { isString, logger, uuid4 } from "@sentry/utils";
import { flush, NodeClient } from "@sentry/node";
import * as domain from "domain";

import type { FastifyError, FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  extractRequestData,
  addFastifyReqToTransaction,
  extractFastifyTransactionName,
  RequestHandlerOptions,
  parseRequest,
  defaultShouldHandleError,
  ErrorHandlerOptions,
  isAutoSessionTrackingEnabled,
} from "./sentry-plugin-helpers";
import { isUuidV4 } from "./utils";

export interface ISentryTracingPluginOpts {
  requestOpts?: RequestHandlerOptions;
  errorOpts?: {
    shouldHandleError?: (error: FastifyError) => boolean;
  };
}

const tracingHandler = (req: FastifyRequest, res: FastifyReply, done: () => void) => {
  // If there is a trace header set, we extract the data from it (parentSpanId, traceId, and sampling decision)
  let traceparentData;
  if (req.headers && isString(req.headers["sentry-trace"])) {
    traceparentData = extractTraceparentData(req.headers["sentry-trace"] as string);
  }

  const transaction = startTransaction(
    {
      name: extractFastifyTransactionName(req, { path: true, method: true }),
      op: "http.server",
      traceId: req.id && typeof req.id === "string" && isUuidV4(req.id) ? req.id : uuid4(),
      ...traceparentData,
    },
    // extra context passed to the tracesSampler
    { request: extractRequestData(req) },
  );

  // We put the transaction on the scope so users can attach children to it
  getCurrentHub().configureScope(scope => {
    scope.setSpan(transaction);
  });

  // We also set __sentry_transaction on the response so people can grab the transaction there to add
  // spans to it later.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-underscore-dangle
  (res as any).__sentry_transaction = transaction;

  res.raw.once("finish", () => {
    // Push `transaction.finish` to the next event loop so open spans have a chance to finish before the transaction
    // closes
    setImmediate(() => {
      // eslint-disable-next-line no-underscore-dangle
      const tx = (res as any).__sentry_transaction as Transaction;
      if (tx) {
        addFastifyReqToTransaction(tx, req);
        tx.setHttpStatus(res.statusCode);
        tx.finish();
      }
    });
  });

  done();
};

const requestHandler =
  (options?: RequestHandlerOptions) =>
  (req: FastifyRequest, res: FastifyReply, done: () => void): void => {
    const currentHub = getCurrentHub();
    const client = currentHub.getClient<NodeClient>();
    // Initialise an instance of SessionFlusher on the client when `autoSessionTracking` is enabled and the
    // `requestHandler` middleware is used indicating that we are running in SessionAggregates mode
    if (client && isAutoSessionTrackingEnabled(client)) {
      client.initSessionFlusher();

      // If Scope contains a Single mode Session, it is removed in favor of using Session Aggregates mode
      const scope = currentHub.getScope();
      if (scope && scope.getSession()) {
        scope.setSession();
      }
    }

    if (options && options.flushTimeout && options.flushTimeout > 0) {
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/unbound-method, no-underscore-dangle, max-len
      const _end = res.raw.end;
      res.raw.end = function sentryRequestEndHandler(
        chunk?: any | (() => void),
        encoding?: string | (() => void),
        cb?: () => void,
      ): void {
        // eslint-disable-next-line no-void
        void flush(options.flushTimeout)
          .then(() => {
            _end.call(this, chunk, encoding as string, cb);
          })
          .then(null, e => {
            logger.error(e);
          });
      };
    }
    const local = domain.create();
    local.add(req.raw);
    local.add(res.raw);
    local.on("error", done);

    local.run(() => {
      const localHub = getCurrentHub();

      localHub.configureScope(scope => {
        scope.addEventProcessor((event: Event) => parseRequest(event, req, options));
        const localClient = localHub.getClient<NodeClient>();

        if (isAutoSessionTrackingEnabled(localClient)) {
          const localScope = localHub.getScope();
          if (localScope) {
            // Set `status` of `RequestSession` to Ok, at the beginning of the request
            localScope.setRequestSession({ status: RequestSessionStatus.Ok });
          }
        }
      });

      res.raw.once("finish", () => {
        const localClient = localHub.getClient<NodeClient>();
        if (isAutoSessionTrackingEnabled(localClient)) {
          setImmediate(() => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-underscore-dangle
            if (localClient && (localClient as any)._captureRequestSession) {
              // Calling _captureRequestSession to capture request session at the end of the request by incrementing
              // the correct SessionAggregates bucket i.e. crashed, errored or exited
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-underscore-dangle
              (localClient as any)._captureRequestSession();
            }
          });
        }
      });
    });

    done();
  };

export const sentryTracingPlugin: FastifyPluginCallback<ISentryTracingPluginOpts> = fp(
  function sentryTracingPluginCb(fastify: FastifyInstance, opts: ISentryTracingPluginOpts, done: () => void) {
    fastify.addHook("preValidation", (req, reply, next) => {
      requestHandler(opts?.requestOpts)(req, reply, next);
    });
    fastify.addHook("preValidation", (req, reply, next) => {
      tracingHandler(req, reply, next);
    });

    done();
  },
  {
    name: "@figedi/sentry-fastify",
    fastify: "3.1",
  },
);

export const errorHandler =
  (options?: ErrorHandlerOptions) => (error: FastifyError, _req: FastifyRequest, res: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const shouldHandleError = (options && options.shouldHandleError) || defaultShouldHandleError;

    if (shouldHandleError(error)) {
      withScope(_scope => {
        // For some reason we need to set the transaction on the scope again
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-underscore-dangle
        const transaction = (res as any).__sentry_transaction as Span;
        if (transaction && _scope.getSpan() === undefined) {
          _scope.setSpan(transaction);
        }

        const client = getCurrentHub().getClient<NodeClient>();
        if (client && isAutoSessionTrackingEnabled(client)) {
          // Check if the `SessionFlusher` is instantiated on the client to go into this branch that marks the
          // `requestSession.status` as `Crashed`, and this check is necessary because the `SessionFlusher` is only
          // instantiated when the the`requestHandler` middleware is initialised, which indicates that we should be
          // running in SessionAggregates mode
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-underscore-dangle
          const isSessionAggregatesMode = (client as any)._sessionFlusher !== undefined;
          if (isSessionAggregatesMode) {
            const requestSession = _scope.getRequestSession();
            // If an error bubbles to the `errorHandler`, then this is an unhandled error, and should be reported as a
            // Crashed session. The `_requestSession.status` is checked to ensure that this error is happening within
            // the bounds of a request, and if so the status is updated
            if (requestSession && requestSession.status !== undefined)
              requestSession.status = RequestSessionStatus.Crashed;
          }
        }

        const eventId = sentryCapture(error, _scope);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (res as any).sentry = eventId;
      });
    }
  };

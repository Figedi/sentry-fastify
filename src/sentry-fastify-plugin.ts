import { captureException } from "@sentry/core";
import type { FastifyError, FastifyInstance, FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";

import { defaultShouldHandleError } from "./sentry-plugin-helpers";

export interface ISentryFastifyPluginOpts {
  /**
   * Callback method deciding whether error should be captured and sent to Sentry
   * @param error Captured middleware error
   */
  shouldHandleError?: (error: FastifyError) => boolean;
}

export const fastifySentryPlugin: FastifyPluginCallback<ISentryFastifyPluginOpts> = fp(
  function (fastify: FastifyInstance, opts: ISentryFastifyPluginOpts, next: () => void) {
    fastify.addHook("onError", (_req, _res, error, done) => {
      const shouldHandleError = opts?.shouldHandleError ?? defaultShouldHandleError;

      if (shouldHandleError(error)) {
        captureException(error);
      }
      done();
    });

    next();
  },
  {
    name: "@figedi/sentry-fastify",
    fastify: "4.x",
  },
);

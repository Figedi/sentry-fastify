import { captureException, type Scope } from '@sentry/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { defaultShouldHandleError } from './sentry-plugin-helpers';

export type SentryFastifyEnrichScope = (request: FastifyRequest, scope: Scope, error: Error) => void;
export interface ISentryFastifyErrorHandlerOpts {
    /**
     * Callback method deciding whether error should be captured and sent to Sentry
     * @param error Captured middleware error
     */
    shouldHandleError?: (error: Error) => boolean;
    /**
     * Runs inside `captureException`’s scope callback before the event is sent.
     */
    enrichScope?: SentryFastifyEnrichScope;
}
export const sentryFastifyErrorHandlerPlugin = fp(
    (fastify: FastifyInstance, opts: ISentryFastifyErrorHandlerOpts, next: (err?: Error) => void) => {
        const shouldHandle = opts.shouldHandleError ?? defaultShouldHandleError;

        fastify.addHook('onError', (request, _reply, error, done) => {
            if (!shouldHandle(error)) {
                done();
                return;
            }
            captureException(error, scope => {
                opts.enrichScope?.(request, scope, error);
                return scope;
            });
            done();
        });

        next();
    },
    {
        name: '@figedi/sentry-fastify',
        fastify: '5.x',
    },
);

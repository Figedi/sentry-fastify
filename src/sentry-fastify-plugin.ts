import { captureException } from '@sentry/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { defaultShouldHandleError } from './sentry-plugin-helpers';

export type SentryFastifyEnrichScope = (request: FastifyRequest, scope: Scope, error: Error) => void;
export interface ISentryFastifyErrorHandlerOpts {
    shouldHandleError?: (error: Error) => boolean;
    /**
     * Runs inside `captureException`’s scope callback before the event is sent.
     * Defaults to {@link defaultEnrichSentryScopeFromFastifyRequest}. Pass `() => {}` to disable enrichment.
     */
    enrichScope?: SentryFastifyEnrichScope;
}
export const sentryFastifyErrorHandlerPlugin = fp(
    (fastify: FastifyInstance, opts: ISentryFastifyErrorHandlerOpts, next: (err?: Error) => void) => {
        const shouldHandle = opts.shouldHandleError ?? defaultShouldHandleError;
        const enrichScope = opts.enrichScope ??  ((_req, _scope, _err) => {});

        fastify.addHook('onError', (request: FastifyRequest, _reply, error: Error, done) => {
            if (!shouldHandle(error)) {
                done();
                return;
            }
            captureException(error, scope => {
                enrichScope(request, scope, error);
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

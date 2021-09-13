## @figedi/sentry-fastify

A fastify compatible request-/tracing-middleware. Mainly ported from the official @sentry/node package

## Usage 

To add tracing, first make sure you have initialized sentry correctly according to their docs, then
during fastify-server initialization, add the following snippets:

```
if (process.env.SENTRY_DSN) {
    server.register(require('@figedi/sentry-fastify').sentryTracingPlugin);
}
```

```
server.setErrorHandler(
    combineErrorHandlers(
        [
            process.env.SENTRY_DSN ? require('./lib/sentry').errorHandler({ shouldHandleError: () => true }) : undefined,
            // your other error handlers here
        ].filter(Boolean),
    ),
);
```


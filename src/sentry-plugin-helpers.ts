import type { FastifyError } from 'fastify';

export const getStatusCodeFromResponse = (error: FastifyError): number => {
    const statusCode = error.statusCode;
    return statusCode ?? 500;
};

/** Returns true if response code is internal server error */
export const defaultShouldHandleError = (error: FastifyError): boolean => {
    const status = getStatusCodeFromResponse(error);
    return status >= 500;
};

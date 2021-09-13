/* eslint-disable no-param-reassign */
import { Event, ExtractedNodeRequestData, Transaction } from "@sentry/types";
import { NodeClient, NodeOptions } from "@sentry/node";
import { isPlainObject, isString, normalize, stripUrlQueryAndFragment } from "@sentry/utils";

import * as os from "os";
import * as url from "url";

import type { FastifyRequest } from "fastify";

/**
 * Options deciding what parts of the request to use when enhancing an event
 */
export interface ParseRequestOptions {
  ip?: boolean;
  request?: boolean | string[];
  serverName?: boolean;
  transaction?: boolean | TransactionNamingScheme;
  user?: boolean | string[];
  version?: boolean;
}

export type RequestHandlerOptions = ParseRequestOptions & {
  flushTimeout?: number;
};
export interface ErrorHandlerOptions {
  /**
   * Callback method deciding whether error should be captured and sent to Sentry
   * @param error Captured middleware error
   */
  shouldHandleError?: (error: MiddlewareError) => boolean;
}

export type TransactionNamingScheme = "path" | "methodPath" | "handler";

export interface MiddlewareError extends Error {
  status?: number | string;
  statusCode?: number | string;
  status_code?: number | string;
  output?: {
    statusCode?: number | string;
  };
}

/** Default request keys that'll be used to extract data from the request */
const DEFAULT_REQUEST_KEYS = ["data", "headers", "method", "query_string", "url"];

/** Default user keys that'll be used to extract data from the request */
const DEFAULT_USER_KEYS = ["id", "username", "email"];

export const isAutoSessionTrackingEnabled = (client?: NodeClient): boolean => {
  if (client === undefined) {
    return false;
  }
  const clientOptions: NodeOptions = client && client.getOptions();
  if (clientOptions && clientOptions.autoSessionTracking !== undefined) {
    return clientOptions.autoSessionTracking;
  }
  return false;
};

/**
 * Extracts complete generalized path from the request object and uses it to construct transaction name.
 *
 * eg. GET /mountpoint/user/:id
 *
 * @param req The FastifyRequest object
 * @param options What to include in the transaction name (method, path, or both)
 *
 * @returns The fully constructed transaction name
 */
export const extractFastifyTransactionName = (
  req: FastifyRequest,
  options: { path?: boolean; method?: boolean } = {},
): string => {
  const method = req.method?.toUpperCase();
  const path = stripUrlQueryAndFragment(req.url || "");
  const normalizedPath = Object.entries((req.params as Record<string, any>) ?? {}).reduce(
    (acc, [paramName, paramVal]) => acc.replace(paramVal.toString(), `:${paramName}`),
    path,
  );

  let info = "";
  if (options.method && method) {
    info += method;
  }
  if (options.method && options.path) {
    info += " ";
  }
  if (options.path && normalizedPath) {
    info += normalizedPath;
  }

  return info;
};

/**
 * Set parameterized as transaction name e.g.: `GET /users/:id`
 * Also adds more context data on the transaction from the request
 */
export const addFastifyReqToTransaction = (transaction: Transaction | undefined, req: FastifyRequest): void => {
  if (!transaction) return;
  transaction.name = extractFastifyTransactionName(req, { path: true, method: true });
  transaction.setData("url", req.url);
  transaction.setData("query", req.query);
};

/**
 * Normalizes data from the request object, accounting for framework differences.
 *
 * @param req The request object from which to extract data
 * @param keys An optional array of keys to include in the normalized data. Defaults to DEFAULT_REQUEST_KEYS if not
 * provided.
 * @returns An object containing normalized request data
 */
export const extractRequestData = (
  req: FastifyRequest,
  keys: string[] = DEFAULT_REQUEST_KEYS,
): ExtractedNodeRequestData => {
  const requestData: ExtractedNodeRequestData = {};

  const headers = req.headers;
  const method = req.method;

  const host = req.hostname;
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const originalUrl = req.url;
  // absolute url
  const absoluteUrl = `${protocol}://${host}${originalUrl}`;

  keys.forEach(key => {
    switch (key) {
      case "headers":
        requestData.headers = headers as Record<string, string>;
        break;
      case "method":
        requestData.method = method;
        break;
      case "url":
        requestData.url = absoluteUrl;
        break;
      case "query_string":
        requestData.query_string = (req.query as Record<string, any>) || url.parse(originalUrl || "", false).query;
        break;
      case "data":
        if (method === "GET" || method === "HEAD") {
          break;
        }

        if (req.body !== undefined) {
          requestData.data = isString(req.body) ? (req.body as string) : JSON.stringify(normalize(req.body));
        }
        break;
      default:
        if ({}.hasOwnProperty.call(req, key)) {
          requestData[key] = (req as { [key: string]: any })[key];
        }
    }
  });

  return requestData;
};

export const extractUserData = (
  user: {
    [key: string]: any;
  },
  keys: boolean | string[],
): Record<string, any> => {
  const extractedUser: { [key: string]: any } = {};
  const attributes = Array.isArray(keys) ? keys : DEFAULT_USER_KEYS;

  attributes.forEach(key => {
    if (user && key in user) {
      extractedUser[key] = user[key];
    }
  });

  return extractedUser;
};

/**
 * Enriches passed event with request data.
 *
 * @param event Will be mutated and enriched with req data
 * @param req Request object
 * @param options object containing flags to enable functionality
 * @hidden
 */
export const parseRequest = (event: Event, req: FastifyRequest, options?: ParseRequestOptions): Event => {
  // eslint-disable-next-line no-param-reassign
  options = {
    ip: false,
    request: true,
    serverName: true,
    transaction: true,
    user: true,
    version: true,
    ...options,
  };

  if (options.version) {
    event.contexts = {
      ...event.contexts,
      runtime: {
        name: "node",
        version: process.version,
      },
    };
  }

  if (options.request) {
    // if the option value is `true`, use the default set of keys by not passing anything to `extractRequestData()`
    const extractedRequestData = Array.isArray(options.request)
      ? extractRequestData(req, options.request)
      : extractRequestData(req);
    event.request = {
      ...event.request,
      ...extractedRequestData,
    };
  }

  if (options.serverName && !event.server_name) {
    event.server_name = process.env.SENTRY_NAME || os.hostname();
  }

  if (options.user) {
    const extractedUser =
      "user" in req && (req as any).user && isPlainObject((req as any).user)
        ? extractUserData((req as any).user, options.user)
        : {};

    if (Object.keys(extractedUser)) {
      event.user = {
        ...event.user,
        ...extractedUser,
      };
    }
  }

  if (options.ip && req.ip) {
    event.user = {
      ...event.user,
      ip_address: req.ip,
    };
  }

  return event;
};

export const getStatusCodeFromResponse = (error: MiddlewareError): number => {
  const statusCode = error.status || error.statusCode || error.status_code || (error.output && error.output.statusCode);
  return statusCode ? parseInt(statusCode as string, 10) : 500;
};

/** Returns true if response code is internal server error */
export const defaultShouldHandleError = (error: MiddlewareError): boolean => {
  const status = getStatusCodeFromResponse(error);
  return status >= 500;
};

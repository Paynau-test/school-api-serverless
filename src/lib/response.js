/**
 * Standard API Gateway response helpers.
 */

// TODO: In production, restrict to specific frontend domain
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export function success(data, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, data }),
  };
}

export function error(message, statusCode = 400) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, error: message }),
  };
}

export function notFound(message = "Resource not found") {
  return error(message, 404);
}

export function serverError(message = "Internal server error") {
  return error(message, 500);
}

#!/usr/bin/env node
/**
 * Reads template.yaml and generates Postman collections.
 * Generates two collections: Local and Production.
 * Run: node scripts/generate-postman.js
 * Or:  make postman
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";

// ── Parse template.yaml ───────────────────

const template = readFileSync("template.yaml", "utf8");

const functionRegex =
  /FunctionName:\s*(\S+)[\s\S]*?Path:\s*(\S+)\s*\n\s*Method:\s*(\S+)/g;
const endpoints = [];
let match;

while ((match = functionRegex.exec(template)) !== null) {
  endpoints.push({
    name: match[1],
    path: match[2],
    method: match[3].toUpperCase(),
  });
}

const authEndpoints = endpoints.filter((ep) => ep.path.startsWith("/auth"));
const studentEndpoints = endpoints.filter((ep) =>
  ep.path.startsWith("/students")
);

// ── Helpers ───────────────────────────────

function getBody(method, path) {
  if (method === "POST" && path.includes("/auth/login")) {
    return {
      mode: "raw",
      raw: JSON.stringify(
        { email: "admin@school.com", password: "password123" },
        null,
        2
      ),
    };
  }
  if (method === "POST" && path.includes("students")) {
    return {
      mode: "raw",
      raw: JSON.stringify(
        {
          first_name: "Juan",
          last_name_father: "Garcia",
          last_name_mother: "Lopez",
          date_of_birth: "2015-03-15",
          gender: "M",
          grade_id: 3,
        },
        null,
        2
      ),
    };
  }
  if (method === "PUT" && path.includes("students")) {
    return {
      mode: "raw",
      raw: JSON.stringify(
        {
          first_name: "Juan Carlos",
          last_name_father: "Garcia",
          last_name_mother: "Lopez",
          date_of_birth: "2015-03-15",
          gender: "M",
          grade_id: 4,
          status: "active",
        },
        null,
        2
      ),
    };
  }
  return undefined;
}

function getQuery(method, path) {
  if (method === "GET" && !path.includes("{") && path.includes("students")) {
    return [
      { key: "term", value: "", description: "Partial name search" },
      { key: "status", value: "active", description: "Filter: active, inactive, suspended" },
      { key: "limit", value: "20" },
      { key: "offset", value: "0" },
    ];
  }
  return undefined;
}

function readableName(fnName) {
  return fnName
    .replace("school-", "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isPublic(path) {
  return path === "/auth/login";
}

function buildRequest(ep, baseUrl) {
  const resolvedPath = ep.path.replace("{id}", "1");
  const headers = [];

  if (ep.method === "POST" || ep.method === "PUT") {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  if (!isPublic(ep.path)) {
    headers.push({ key: "Authorization", value: "Bearer {{token}}", type: "text" });
  }

  const request = {
    method: ep.method,
    header: headers,
    url: {
      raw: `{{base_url}}${resolvedPath}`,
      host: ["{{base_url}}"],
      path: resolvedPath.split("/").filter(Boolean),
    },
  };

  const body = getBody(ep.method, ep.path);
  if (body) request.body = body;

  const query = getQuery(ep.method, ep.path);
  if (query) request.url.query = query;

  return request;
}

function loginTestScript() {
  return [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          'const res = pm.response.json();',
          'if (res.success && res.data && res.data.token) {',
          '    pm.collectionVariables.set("token", res.data.token);',
          '    console.log("Token saved to collection variable");',
          '}',
        ],
      },
    },
  ];
}

// ── Build collection for a given environment ──

function buildCollection(envName, baseUrl, postmanId) {
  return {
    info: {
      name: `School API - ${envName}`,
      _postman_id: postmanId,
      description: `Auto-generated from template.yaml.\nEnvironment: ${envName}\nBase URL: ${baseUrl}\n\nFlow: 1) Login → 2) Token auto-saved → 3) Use protected endpoints.`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "base_url", value: baseUrl, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    item: [
      {
        name: "Auth",
        item: authEndpoints.map((ep) => {
          const item = { name: readableName(ep.name), request: buildRequest(ep, baseUrl) };
          if (ep.path === "/auth/login" && ep.method === "POST") {
            item.event = loginTestScript();
          }
          return item;
        }),
      },
      {
        name: "Students",
        item: studentEndpoints.map((ep) => ({
          name: readableName(ep.name),
          request: buildRequest(ep, baseUrl),
        })),
      },
    ],
  };
}

// ── Read production URL if available ──────

let prodUrl = "https://DEPLOY_FIRST.execute-api.us-east-1.amazonaws.com/dev";
const prodUrlEnv = process.env.PROD_URL;
if (prodUrlEnv) {
  prodUrl = prodUrlEnv;
}

// ── Generate files ────────────────────────

mkdirSync("postman", { recursive: true });

const localCollection = buildCollection("Local", "http://localhost:3000", "school-api-local");
const prodCollection = buildCollection("Production", prodUrl, "school-api-production");

writeFileSync(
  "postman/school-api-local.postman_collection.json",
  JSON.stringify(localCollection, null, 2)
);
writeFileSync(
  "postman/school-api-production.postman_collection.json",
  JSON.stringify(prodCollection, null, 2)
);

console.log(`Generated postman/school-api-local.postman_collection.json (${endpoints.length} endpoints)`);
console.log(`Generated postman/school-api-production.postman_collection.json (${endpoints.length} endpoints)`);

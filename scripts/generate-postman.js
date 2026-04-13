#!/usr/bin/env node
/**
 * Reads template.yaml and generates/updates the Postman collection.
 * Run: node scripts/generate-postman.js
 * Or:  make postman
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";

// Simple YAML parser for SAM template (just extracts API events)
const template = readFileSync("template.yaml", "utf8");

// Extract all API events: Path + Method + FunctionName
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

// Generate request body examples based on method
function getBody(method, path) {
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

// Generate query params for GET list endpoints
function getQuery(method, path) {
  if (method === "GET" && !path.includes("{")) {
    return [
      { key: "term", value: "", description: "Partial name search" },
      {
        key: "status",
        value: "active",
        description: "Filter: active, inactive, suspended",
      },
      { key: "limit", value: "20" },
      { key: "offset", value: "0" },
    ];
  }
  return undefined;
}

// Build readable name from function name
function readableName(fnName) {
  return fnName
    .replace("school-", "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Build Postman collection
const collection = {
  info: {
    name: "School API - Student CRUD",
    _postman_id: "school-api-v1",
    description:
      "Auto-generated from template.yaml.\nRun: make postman\n\nSwitch base_url variable between local and AWS.",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "base_url", value: "http://localhost:3000", type: "string" },
  ],
  item: [
    {
      name: "Students",
      item: endpoints.map((ep) => {
        const resolvedPath = ep.path.replace("{id}", "1");
        const request = {
          method: ep.method,
          header:
            ep.method === "POST" || ep.method === "PUT"
              ? [{ key: "Content-Type", value: "application/json" }]
              : [],
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

        return { name: readableName(ep.name), request };
      }),
    },
  ],
};

mkdirSync("postman", { recursive: true });
writeFileSync(
  "postman/school-api.postman_collection.json",
  JSON.stringify(collection, null, 2)
);

console.log(
  `Generated postman/school-api.postman_collection.json (${endpoints.length} endpoints)`
);

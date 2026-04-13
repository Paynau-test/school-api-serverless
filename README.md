# school-api-node

REST API for the school management system. Built with Node.js 20, AWS Lambda, and API Gateway using AWS SAM.

## Requirements

- Node.js 20+
- AWS SAM CLI (`brew install aws-sam-cli`)
- Docker (for local testing)
- school-db running locally (`make up` in school-db)

## Quick Start (Local)

```bash
make install    # Install dependencies
make dev        # Start API in background on http://localhost:3000
make logs-tail  # Follow logs in real time
```

Requires school-db Docker containers running. The API connects to your local MySQL on port 3306.

## Endpoints

All endpoints (except login) require a JWT token in the `Authorization: Bearer <token>` header.

```
Auth:
  POST   /auth/login        Login (returns JWT token)
  GET    /auth/me            Get authenticated user profile

Students (admin + teacher can read, only admin can write):
  POST   /students           Create student          [admin]
  GET    /students            Search students          [any authenticated]
  GET    /students/{id}       Get student by ID        [any authenticated]
  PUT    /students/{id}       Update student           [admin]
  DELETE /students/{id}       Soft delete student      [admin]
```

## Request/Response Format

All responses follow the same structure:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Error message" }
```

### Login
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@school.com","password":"password123"}'
```

### Create Student (requires admin token)
```bash
curl -X POST http://localhost:3000/students \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "first_name": "Juan",
    "last_name_father": "Garcia",
    "last_name_mother": "Lopez",
    "date_of_birth": "2015-03-15",
    "gender": "M",
    "grade_id": 3
  }'
```

### Search Students
```bash
curl "http://localhost:3000/students?term=Garcia&status=active" \
  -H "Authorization: Bearer <token>"
```

## Deploy to AWS

```bash
make deploy       # Build and deploy API + Lambdas to AWS
make db-deploy    # Run database migration on production RDS (via Lambda)
```

`make deploy` automatically reads VPC, subnets, and DB credentials from AWS. No manual configuration needed.

## Database Migrations

When you change the database structure (tables, stored procedures, seeds):

1. Update the individual files in `school-db/` (migrations, stored-procedures, seeds)
2. Update `src/handlers/db-migrate.js` to match the changes
3. Run `make deploy` then `make db-deploy`

The migration Lambda is idempotent (safe to run multiple times).

## Architecture

```
API Gateway → Lambda (VPC) → RDS MySQL (private subnet)
                                ↑
                        Stored Procedures
```

Each CRUD operation is a separate Lambda function. They share a MySQL connection pool (reused across warm invocations) and call stored procedures defined in school-db.

## Available Commands

```
Local:
  make install        Install dependencies
  make dev            Start API in background (port 3000)
  make stop           Stop background API
  make restart        Restart API
  make status         Check if running
  make logs           Last 50 lines
  make logs-tail      Follow logs in real time

Production:
  make deploy         Build and deploy to AWS
  make db-deploy      Run DB migration on production RDS
  make destroy        Delete the CloudFormation stack

Postman:
  make postman        Generate local Postman collection
  make postman-prod   Generate local + production collections
```

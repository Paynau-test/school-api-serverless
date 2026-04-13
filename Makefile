# ============================================
# school-api-serverless · Makefile
# ============================================

.PHONY: install dev build deploy invoke-create invoke-get invoke-search logs postman help

# ── Setup ───────────────────────────────────

install:
	@npm install

# ── Local Development ───────────────────────

dev:
	@echo "Starting local API on http://localhost:3000 ..."
	@sam local start-api --warm-containers eager --parameter-overrides \
		DbHost=host.docker.internal \
		DbPort=3306 \
		DbName=school_db \
		DbUser=school_user \
		DbPassword=school_pass

# ── Build & Deploy ──────────────────────────

build:
	@sam build

deploy:
	@sam build
	@sam deploy --no-confirm-changeset

# ── Test locally with events ────────────────

invoke-create:
	@sam local invoke CreateStudentFunction --event events/create-student.json \
		--parameter-overrides DbHost=host.docker.internal

invoke-get:
	@sam local invoke GetStudentFunction --event events/get-student.json \
		--parameter-overrides DbHost=host.docker.internal

invoke-search:
	@sam local invoke SearchStudentsFunction --event events/search-students.json \
		--parameter-overrides DbHost=host.docker.internal

# ── Postman ─────────────────────────────────

postman:
	@node scripts/generate-postman.js

# ── Logs ────────────────────────────────────

logs:
	@sam logs --stack-name school-api-serverless --tail

# ── Help ────────────────────────────────────

help:
	@echo ""
	@echo "school-api-serverless commands:"
	@echo ""
	@echo "  make install        Install dependencies"
	@echo "  make dev            Start local API (needs Docker + school-db running)"
	@echo "  make build          Build SAM project"
	@echo "  make deploy         Build and deploy to AWS"
	@echo "  make invoke-create  Test create-student locally"
	@echo "  make invoke-get     Test get-student locally"
	@echo "  make invoke-search  Test search-students locally"
	@echo "  make postman        Regenerate Postman collection from template.yaml"
	@echo "  make logs           Tail CloudWatch logs"
	@echo ""

# ============================================
# school-api-node · Makefile
# ============================================

API_PID_FILE := .api.pid
API_LOG_FILE := .api.log

.PHONY: install dev stop restart status logs logs-tail build deploy \
        invoke-create invoke-get invoke-search invoke-login postman help

# ── Setup ───────────────────────────────────

install:
	@npm install

# ── Local Development ───────────────────────

dev:
	@if [ -f $(API_PID_FILE) ] && kill -0 $$(cat $(API_PID_FILE)) 2>/dev/null; then \
		echo "API already running (PID $$(cat $(API_PID_FILE))). Use: make restart"; \
	else \
		echo "Starting local API on http://localhost:3000 (background) ..."; \
		nohup sam local start-api --warm-containers eager --parameter-overrides \
			DbHost=host.docker.internal \
			DbPort=3306 \
			DbName=school_db \
			DbUser=school_user \
			DbPassword=school_pass \
			JwtSecret=dev-secret-change-in-production \
			> $(API_LOG_FILE) 2>&1 & \
		echo $$! > $(API_PID_FILE); \
		sleep 2; \
		if kill -0 $$(cat $(API_PID_FILE)) 2>/dev/null; then \
			echo "API running in background (PID $$(cat $(API_PID_FILE)))"; \
			echo "  Logs:    make logs"; \
			echo "  Stop:    make stop"; \
		else \
			echo "Failed to start. Check: make logs"; \
			rm -f $(API_PID_FILE); \
		fi; \
	fi

stop:
	@if [ -f $(API_PID_FILE) ]; then \
		PID=$$(cat $(API_PID_FILE)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID 2>/dev/null; \
			echo "API stopped (PID $$PID)"; \
		else \
			echo "Process $$PID already dead, cleaning up"; \
		fi; \
		rm -f $(API_PID_FILE); \
	else \
		echo "No API running (no pid file)"; \
	fi

restart: stop
	@sleep 1
	@$(MAKE) dev

status:
	@if [ -f $(API_PID_FILE) ] && kill -0 $$(cat $(API_PID_FILE)) 2>/dev/null; then \
		echo "API is running (PID $$(cat $(API_PID_FILE)))"; \
	else \
		echo "API is not running"; \
		rm -f $(API_PID_FILE) 2>/dev/null; \
	fi

# ── Logs ────────────────────────────────────

logs:
	@if [ -f $(API_LOG_FILE) ]; then \
		tail -50 $(API_LOG_FILE); \
	else \
		echo "No log file. Start the API first: make dev"; \
	fi

logs-tail:
	@if [ -f $(API_LOG_FILE) ]; then \
		tail -f $(API_LOG_FILE); \
	else \
		echo "No log file. Start the API first: make dev"; \
	fi

logs-aws:
	@sam logs --stack-name school-api-node --tail

# ── Build & Deploy ──────────────────────────

build:
	@sam build

deploy:
	@echo "Reading infra outputs from AWS..."
	@VPC_ID=$$(aws cloudformation describe-stacks --stack-name SchoolNetwork --region us-east-1 \
		--query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' --output text) && \
	SUBNETS=$$(aws ec2 describe-subnets --region us-east-1 \
		--filters "Name=vpc-id,Values=$$VPC_ID" "Name=tag:aws-cdk:subnet-type,Values=Private" \
		--query 'Subnets[].SubnetId' --output text | tr '\t' ',') && \
	DB_HOST=$$(aws cloudformation describe-stacks --stack-name SchoolDatabase --region us-east-1 \
		--query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' --output text) && \
	DB_SECRET=$$(aws secretsmanager get-secret-value --secret-id school-db-credentials --region us-east-1 \
		--query SecretString --output text) && \
	DB_USER=$$(echo "$$DB_SECRET" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])") && \
	DB_PASS=$$(echo "$$DB_SECRET" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])") && \
	echo "VPC: $$VPC_ID" && \
	echo "Subnets: $$SUBNETS" && \
	echo "DB Host: $$DB_HOST" && \
	echo "DB User: $$DB_USER" && \
	sam build && \
	sam deploy --stack-name school-api-node \
		--region us-east-1 \
		--capabilities CAPABILITY_IAM \
		--resolve-s3 \
		--no-confirm-changeset \
		--tags project=school environment=dev owner=isaac \
		--parameter-overrides \
			VpcId=$$VPC_ID \
			SubnetIds=$$SUBNETS \
			DbHost=$$DB_HOST \
			DbUser=$$DB_USER \
			DbPassword=$$DB_PASS \
			DbName=school_db \
			JwtSecret=school-jwt-secret-prod-2026 \
	|| echo "Stack already up to date."

db-deploy:
	@echo "Running database migration on production RDS..."
	@aws lambda invoke --function-name school-db-migrate \
		--region us-east-1 \
		--cli-read-timeout 120 \
		/tmp/db-migrate-response.json > /dev/null 2>&1 && \
	RESULT=$$(cat /tmp/db-migrate-response.json) && \
	STATUS=$$(echo "$$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCode', 500))") && \
	if [ "$$STATUS" = "200" ]; then \
		echo "Database migrated successfully."; \
	else \
		echo "Migration failed:"; \
		echo "$$RESULT" | python3 -m json.tool; \
		exit 1; \
	fi

destroy:
	@echo "Destroying school-api-node stack..."
	@sam delete --stack-name school-api-node --no-prompts
	@echo "Done."

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

invoke-login:
	@sam local invoke LoginFunction --event events/login.json \
		--parameter-overrides DbHost=host.docker.internal

# ── Postman ─────────────────────────────────

postman:
	@node scripts/generate-postman.js

postman-prod:
	@echo "Reading API URL from deployed stack..."
	@API_URL=$$(aws cloudformation describe-stacks \
		--stack-name school-api-node \
		--region us-east-1 \
		--query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
		--output text 2>/dev/null) && \
	if [ -n "$$API_URL" ] && [ "$$API_URL" != "None" ]; then \
		PROD_URL="$$API_URL" node scripts/generate-postman.js; \
		echo "Production URL: $$API_URL"; \
	else \
		echo "Stack not deployed yet. Run: make deploy"; \
	fi

# ── Help ────────────────────────────────────

help:
	@echo ""
	@echo "school-api-node commands:"
	@echo ""
	@echo "  make dev            Start API in background (no terminal lock)"
	@echo "  make stop           Stop the background API"
	@echo "  make restart        Stop + start"
	@echo "  make status         Check if API is running"
	@echo ""
	@echo "  make logs           Last 50 lines of API output"
	@echo "  make logs-tail      Follow logs in real-time (Ctrl+C to exit)"
	@echo "  make logs-aws       Tail CloudWatch logs (deployed)"
	@echo ""
	@echo "  make install        Install dependencies"
	@echo "  make build          Build SAM project"
	@echo "  make deploy         Build and deploy to AWS"
	@echo "  make db-deploy      Run DB migration on production RDS"
	@echo ""
	@echo "  make invoke-login   Test login locally"
	@echo "  make invoke-create  Test create-student locally"
	@echo "  make invoke-get     Test get-student locally"
	@echo "  make invoke-search  Test search-students locally"
	@echo "  make postman        Regenerate Postman collection"
	@echo "  make postman-prod   Same + fetch production URL from AWS"
	@echo ""

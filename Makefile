# Lumen on-prem build / deploy helpers (ε.3).
#
#   make onprem        — build all on-prem images
#   make onprem-up     — build + start the stack via docker compose
#   make onprem-down   — stop + remove containers (preserves volumes)
#   make onprem-logs   — tail compose logs
#   make onprem-reset  — DESTROY all on-prem state (volumes too)
#
# These targets are idempotent and require Docker + Docker Compose v2.

.PHONY: onprem onprem-up onprem-down onprem-logs onprem-reset

ENV ?= .env.onprem

onprem:
	docker compose --env-file $(ENV) build

onprem-up: onprem
	docker compose --env-file $(ENV) up -d
	@echo ""
	@echo "✓ Lumen on-prem is up. Visit http://localhost in your browser."
	@echo "  Tail logs: make onprem-logs"

onprem-down:
	docker compose --env-file $(ENV) down

onprem-logs:
	docker compose --env-file $(ENV) logs -f --tail=100

onprem-reset:
	@echo "⚠️  This will delete every workspace + collab snapshot. Press Ctrl-C now to cancel."
	@sleep 5
	docker compose --env-file $(ENV) down -v

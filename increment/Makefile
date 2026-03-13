default: build

all: test

test: build
	cargo test

build:
	stellar contract build
	@find target -path '*/release/*.wasm' -name '*.wasm' | head -1 | xargs ls -l

fmt:
	cargo fmt --all

clean:
	cargo clean

# ── Integration test targets ──

start-stellar-node:
	@echo "Starting local Stellar sandbox..."
	docker run -d --name stellar-local -p 8000:8000 stellar/quickstart:testing --standalone
	@echo "Waiting for Soroban RPC to become healthy..."
	@until curl -sf http://localhost:8000/soroban/rpc \
		-X POST -H 'Content-Type: application/json' \
		-d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' > /dev/null 2>&1; do \
		echo "  waiting..."; sleep 3; \
	done
	@echo "Stellar sandbox ready."

stop-stellar-node:
	@echo "Stopping Stellar sandbox..."
	-docker stop stellar-local 2>/dev/null
	-docker rm stellar-local 2>/dev/null
	@echo "Stellar sandbox stopped."

test-integration: build
	@echo "Running integration tests..."
	npx dotenv-cli -e .env.test -- jest --detectOpenHandles --forceExit

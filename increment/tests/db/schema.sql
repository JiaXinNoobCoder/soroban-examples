-- Increment contract integration test schema

CREATE TABLE IF NOT EXISTS contract_deployments (
    id              SERIAL PRIMARY KEY,
    contract_address TEXT NOT NULL UNIQUE,
    wasm_hash       TEXT NOT NULL,
    deployer        TEXT NOT NULL,
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_invocations (
    id               SERIAL PRIMARY KEY,
    contract_address TEXT NOT NULL REFERENCES contract_deployments(contract_address),
    function_name    TEXT NOT NULL,
    tx_hash          TEXT NOT NULL,
    return_value     INTEGER,
    invoked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

import { Pool } from "pg";

/**
 * Lightweight repository for tracking contract deployments and invocations.
 * Mirrors rain's TestingContext pattern: real DB writes + assertions.
 */
export class ContractRepo {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  /**
   * Drop and recreate all tables — equivalent to rain's resetApiDB / resetLedgerDB.
   */
  async resetDB(): Promise<void> {
    await this.pool.query("DROP TABLE IF EXISTS contract_invocations CASCADE");
    await this.pool.query("DROP TABLE IF EXISTS contract_deployments CASCADE");
    await this.pool.query(`
      CREATE TABLE contract_deployments (
        id               SERIAL PRIMARY KEY,
        contract_address TEXT NOT NULL UNIQUE,
        wasm_hash        TEXT NOT NULL,
        deployer         TEXT NOT NULL,
        deployed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE contract_invocations (
        id               SERIAL PRIMARY KEY,
        contract_address TEXT NOT NULL REFERENCES contract_deployments(contract_address),
        function_name    TEXT NOT NULL,
        tx_hash          TEXT NOT NULL,
        return_value     INTEGER,
        invoked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * Record a successful contract deployment.
   */
  async recordDeployment(contractAddress: string, wasmHash: string, deployer: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO contract_deployments (contract_address, wasm_hash, deployer) VALUES ($1, $2, $3)",
      [contractAddress, wasmHash, deployer]
    );
  }

  /**
   * Record a successful contract invocation with its return value.
   */
  async recordInvocation(
    contractAddress: string,
    functionName: string,
    txHash: string,
    returnValue: number | null
  ): Promise<void> {
    await this.pool.query(
      "INSERT INTO contract_invocations (contract_address, function_name, tx_hash, return_value) VALUES ($1, $2, $3, $4)",
      [contractAddress, functionName, txHash, returnValue]
    );
  }

  /**
   * Fetch all invocations for a contract, ordered by invocation time.
   */
  async getInvocations(contractAddress: string): Promise<
    Array<{
      function_name: string;
      tx_hash: string;
      return_value: number | null;
    }>
  > {
    const result = await this.pool.query(
      "SELECT function_name, tx_hash, return_value FROM contract_invocations WHERE contract_address = $1 ORDER BY invoked_at ASC",
      [contractAddress]
    );
    return result.rows;
  }

  /**
   * Fetch deployment record by contract address.
   */
  async getDeployment(contractAddress: string): Promise<{
    contract_address: string;
    wasm_hash: string;
    deployer: string;
  } | null> {
    const result = await this.pool.query(
      "SELECT contract_address, wasm_hash, deployer FROM contract_deployments WHERE contract_address = $1",
      [contractAddress]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Close the connection pool.
   */
  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

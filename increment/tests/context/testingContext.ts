import { ContractRepo } from "../db/repo";
import { StellarContext } from "./stellarContext";

/**
 * Combined test context: chain + database.
 * Mirrors rain's TestingContext<StellarContext> pattern:
 *   - init() → reset DB + fund deployer
 *   - dispose() → close all connections
 */
export class TestingContext {
  readonly chain: StellarContext;
  readonly repo: ContractRepo;

  private constructor(chain: StellarContext, repo: ContractRepo) {
    this.chain = chain;
    this.repo = repo;
  }

  /**
   * Factory method — mirrors rain's TestingContext.init(StellarContext).
   * 1. Create StellarContext + generate deployer keypair
   * 2. Create ContractRepo + reset DB (drop & recreate tables)
   * 3. Fund deployer via friendbot
   */
  static async init(): Promise<TestingContext> {
    const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/test";

    const chain = new StellarContext();
    const repo = new ContractRepo(databaseUrl);

    // Reset DB — equivalent to rain's resetApiDB + resetLedgerDB
    await repo.resetDB();

    // Fund deployer — equivalent to rain's StellarContext.airdropNative()
    await chain.fundDeployer();

    return new TestingContext(chain, repo);
  }

  /**
   * Clean up — mirrors rain's TestingContext.dispose().
   */
  async dispose(): Promise<void> {
    await this.repo.dispose();
  }
}

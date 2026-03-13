import { TestingContext } from "./context/testingContext";

/**
 * Increment contract integration tests.
 *
 * Pattern mirrors rain's stellarBlockchainManager.test.ts:
 *   - beforeAll: init TestingContext (reset DB + fund deployer)
 *   - tests: deploy contract, invoke, assert chain + DB state
 *   - afterAll: dispose context
 */

jest.setTimeout(120000);

describe("Increment Contract Integration Tests", () => {
  let ctx: TestingContext;
  let contractAddress: string;
  let wasmHash: string;

  beforeAll(async () => {
    ctx = await TestingContext.init();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.dispose();
    }
  });

  // ── Deployment ──

  it("01 - should deploy the increment contract", async () => {
    const result = await ctx.chain.deployContract();

    contractAddress = result.contractAddress;
    wasmHash = result.wasmHash;

    // Chain assertions
    expect(contractAddress).toBeTruthy();
    expect(contractAddress.startsWith("C")).toBe(true); // Stellar contract addresses start with C
    expect(wasmHash).toBeTruthy();
    expect(wasmHash.length).toBe(64); // SHA-256 hex

    // Record to DB — mirrors rain's pattern of writing blockchain state to repo
    await ctx.repo.recordDeployment(contractAddress, wasmHash, ctx.chain.deployer.publicKey());

    // DB assertion
    const deployment = await ctx.repo.getDeployment(contractAddress);
    expect(deployment).not.toBeNull();
    expect(deployment!.contract_address).toBe(contractAddress);
    expect(deployment!.wasm_hash).toBe(wasmHash);
    expect(deployment!.deployer).toBe(ctx.chain.deployer.publicKey());
  });

  // ── First invocation ──

  it("02 - should increment counter to 1", async () => {
    const { txHash, returnValue } = await ctx.chain.invokeIncrement(contractAddress);

    // Chain assertions
    expect(returnValue).toBe(1);
    expect(txHash).toBeTruthy();

    // Record to DB
    await ctx.repo.recordInvocation(contractAddress, "increment", txHash, returnValue);

    // DB assertion
    const invocations = await ctx.repo.getInvocations(contractAddress);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].return_value).toBe(1);
    expect(invocations[0].tx_hash).toBe(txHash);
  });

  // ── Sequential invocations ──

  it("03 - should increment counter to 2 and 3", async () => {
    // Second call
    const call2 = await ctx.chain.invokeIncrement(contractAddress);
    expect(call2.returnValue).toBe(2);
    await ctx.repo.recordInvocation(contractAddress, "increment", call2.txHash, call2.returnValue);

    // Third call
    const call3 = await ctx.chain.invokeIncrement(contractAddress);
    expect(call3.returnValue).toBe(3);
    await ctx.repo.recordInvocation(contractAddress, "increment", call3.txHash, call3.returnValue);

    // DB assertion — all 3 invocations recorded in order
    const invocations = await ctx.repo.getInvocations(contractAddress);
    expect(invocations).toHaveLength(3);
    expect(invocations.map((i) => i.return_value)).toEqual([1, 2, 3]);

    // All tx hashes should be unique
    const hashes = invocations.map((i) => i.tx_hash);
    expect(new Set(hashes).size).toBe(3);
  });

  // ── DB consistency ──

  it("04 - should have consistent deployment and invocation records", async () => {
    const deployment = await ctx.repo.getDeployment(contractAddress);
    expect(deployment).not.toBeNull();

    const invocations = await ctx.repo.getInvocations(contractAddress);
    expect(invocations).toHaveLength(3);

    // Every invocation references the same deployed contract
    for (const inv of invocations) {
      expect(inv.function_name).toBe("increment");
    }
  });
});

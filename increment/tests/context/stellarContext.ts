import * as StellarSdk from "@stellar/stellar-sdk";
import * as fs from "fs";
import * as path from "path";

/**
 * Stellar chain context for integration tests.
 * Mirrors rain's StellarContext: manages keypairs, funds accounts,
 * deploys contracts, invokes functions, and polls transactions.
 */
export class StellarContext {
  readonly rpcServer: StellarSdk.rpc.Server;
  readonly horizonUrl: string;
  readonly friendbotUrl: string;
  readonly networkPassphrase: string;

  /** The deployer keypair — funded via friendbot, used to deploy & invoke. */
  readonly deployer: StellarSdk.Keypair;

  constructor() {
    const rpcUrl = process.env.SOROBAN_RPC_URL || "http://localhost:8000/soroban/rpc";
    this.horizonUrl = process.env.HORIZON_URL || "http://localhost:8000";
    this.friendbotUrl = process.env.FRIENDBOT_URL || "http://localhost:8000/friendbot";
    this.networkPassphrase = process.env.NETWORK_PASSPHRASE || "Standalone Network ; February 2017";

    this.rpcServer = new StellarSdk.rpc.Server(rpcUrl, { allowHttp: true });
    this.deployer = StellarSdk.Keypair.random();
  }

  /**
   * Fund the deployer account via friendbot (local standalone network).
   * Mirrors rain's StellarContext.airdropNative().
   */
  async fundDeployer(): Promise<void> {
    const url = `${this.friendbotUrl}?addr=${this.deployer.publicKey()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Friendbot funding failed (${res.status}): ${await res.text()}`);
    }
  }

  /**
   * Deploy the increment contract WASM to the local network.
   * Returns the contract address (StrKey C... format) and the WASM hash.
   */
  async deployContract(): Promise<{ contractAddress: string; wasmHash: string }> {
    // Locate the compiled WASM — try both target triples
    const candidates = [
      path.resolve(__dirname, "../../target/wasm32v1-none/release/soroban_increment_contract.wasm"),
      path.resolve(__dirname, "../../target/wasm32-unknown-unknown/release/soroban_increment_contract.wasm"),
    ];
    const wasmPath = candidates.find((p) => fs.existsSync(p));
    if (!wasmPath) {
      throw new Error(`WASM not found. Tried:\n${candidates.join("\n")}\nRun 'make build' first.`);
    }
    const wasmBytes = fs.readFileSync(wasmPath);

    // ── Step 1: Upload WASM ──
    const account = await this.rpcServer.getAccount(this.deployer.publicKey());
    const uploadTx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes),
          auth: [],
        })
      )
      .setTimeout(30)
      .build();

    const preparedUpload = await this.rpcServer.prepareTransaction(uploadTx);
    preparedUpload.sign(this.deployer);
    const uploadResult = await this.rpcServer.sendTransaction(preparedUpload);
    const uploadResponse = await this.pollTransaction(uploadResult.hash);

    // Extract WASM hash from the return value
    const wasmHashBuffer = uploadResponse.returnValue!.bytes();
    const wasmHash = Buffer.from(wasmHashBuffer).toString("hex");

    // ── Step 2: Create contract instance ──
    const account2 = await this.rpcServer.getAccount(this.deployer.publicKey());
    const salt = StellarSdk.Keypair.random().rawPublicKey(); // 32 random bytes as salt

    const createContractArgs = new StellarSdk.xdr.CreateContractArgs({
      contractIdPreimage:
        StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new StellarSdk.xdr.ContractIdPreimageFromAddress({
            address: new StellarSdk.Address(this.deployer.publicKey()).toScAddress(),
            salt: salt,
          })
        ),
      executable: StellarSdk.xdr.ContractExecutable.contractExecutableWasm(
        Buffer.from(wasmHash, "hex")
      ),
    });

    const createTx = new StellarSdk.TransactionBuilder(account2, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs),
          auth: [],
        })
      )
      .setTimeout(30)
      .build();

    const preparedCreate = await this.rpcServer.prepareTransaction(createTx);
    preparedCreate.sign(this.deployer);
    const createResult = await this.rpcServer.sendTransaction(preparedCreate);
    const createResponse = await this.pollTransaction(createResult.hash);

    // Extract contract address from the return value
    const contractAddress = StellarSdk.Address.fromScVal(createResponse.returnValue!).toString();

    return { contractAddress, wasmHash };
  }

  /**
   * Invoke the `increment` function on the deployed contract.
   * Returns the tx hash and the u32 return value.
   */
  async invokeIncrement(contractAddress: string): Promise<{ txHash: string; returnValue: number }> {
    const contract = new StellarSdk.Contract(contractAddress);
    const account = await this.rpcServer.getAccount(this.deployer.publicKey());

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call("increment"))
      .setTimeout(30)
      .build();

    const prepared = await this.rpcServer.prepareTransaction(tx);
    prepared.sign(this.deployer);
    const result = await this.rpcServer.sendTransaction(prepared);
    const response = await this.pollTransaction(result.hash);

    const returnValue = StellarSdk.scValToNative(response.returnValue!) as number;

    return { txHash: result.hash, returnValue };
  }

  /**
   * Poll a transaction until SUCCESS or failure.
   * Mirrors rain's stellarTestUtils.ts pollTransaction pattern.
   */
  async pollTransaction(hash: string): Promise<StellarSdk.rpc.Api.GetSuccessfulTransactionResponse> {
    const response = await this.rpcServer.pollTransaction(hash, {
      sleepStrategy: () => 500,
      attempts: 40,
    });

    if (response.status === "SUCCESS") {
      return response as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse;
    }
    throw new Error(`Transaction ${hash} failed with status: ${response.status}`);
  }
}

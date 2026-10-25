import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  type Account,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi } from "@blindcount/contracts";
import type { Config } from "./config";

export const COHORT_STATE = { NONE: 0, CREATED: 1, FROZEN: 2, CLOSED: 3 } as const;
export const ASSIGNMENT_STATE = { NONE: 0, REGISTERED: 1, ANCHORED: 2, VOIDED: 3 } as const;

export interface ChainStatus {
  ok: boolean;
  chainId?: number;
  blockNumber?: string;
  relayerBalanceWei?: string;
  error?: string;
}

export interface ConfirmedTx {
  txHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
}

/** Relayer for registry writes. Field devices never send transactions (PRD 8.1). */
export class Registry {
  readonly address: Address;
  readonly chain: Chain;
  readonly pub: PublicClient;
  private readonly wallet: WalletClient;
  private readonly relayer: Account;
  readonly voidApprover: ReturnType<typeof privateKeyToAccount>;
  private readonly confirmations: number;

  private readonly deployBlock: bigint;

  constructor(cfg: Pick<Config, "CHAIN_ID" | "CHAIN_NAME" | "CHAIN_RPC_URL" | "CHAIN_REGISTRY_ADDRESS" | "CHAIN_RELAYER_PRIVATE_KEY" | "CHAIN_VOID_APPROVER_PRIVATE_KEY" | "CHAIN_CONFIRMATIONS" | "CHAIN_REGISTRY_DEPLOY_BLOCK">) {
    this.chain = defineChain({
      id: cfg.CHAIN_ID,
      name: cfg.CHAIN_NAME,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [cfg.CHAIN_RPC_URL] } },
    });
    const transport = http(cfg.CHAIN_RPC_URL, { timeout: 15_000, retryCount: 2 });
    this.pub = createPublicClient({ chain: this.chain, transport });
    this.relayer = privateKeyToAccount(cfg.CHAIN_RELAYER_PRIVATE_KEY as Hex);
    this.voidApprover = privateKeyToAccount(cfg.CHAIN_VOID_APPROVER_PRIVATE_KEY as Hex);
    this.wallet = createWalletClient({ chain: this.chain, transport, account: this.relayer });
    this.address = cfg.CHAIN_REGISTRY_ADDRESS as Address;
    this.confirmations = cfg.CHAIN_CONFIRMATIONS;
    this.deployBlock = BigInt(cfg.CHAIN_REGISTRY_DEPLOY_BLOCK);
  }

  get relayerAddress(): Address {
    return this.relayer.address;
  }

  async status(): Promise<ChainStatus> {
    try {
      const [chainId, blockNumber, balance, code] = await Promise.all([
        this.pub.getChainId(),
        this.pub.getBlockNumber(),
        this.pub.getBalance({ address: this.relayer.address }),
        this.pub.getCode({ address: this.address }),
      ]);
      if (!code || code === "0x") return { ok: false, chainId, error: "registry contract not deployed at configured address" };
      return { ok: chainId === this.chain.id, chainId, blockNumber: blockNumber.toString(), relayerBalanceWei: balance.toString() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "rpc error" };
    }
  }

  cohortStatus(cohortKey: Hex) {
    return this.pub
      .readContract({ address: this.address, abi: registryAbi, functionName: "getCohortStatus", args: [cohortKey] })
      .then(([state, expected, registered, terminal, target]) => ({ state, expected, registered, terminal, target }));
  }

  assignmentStatus(cohortKey: Hex, assignmentKey: Hex) {
    return this.pub
      .readContract({ address: this.address, abi: registryAbi, functionName: "getAssignmentStatus", args: [cohortKey, assignmentKey] })
      .then(([state, latestVersion]) => ({ state, latestVersion }));
  }

  observationCommitment(cohortKey: Hex, assignmentKey: Hex, version: number): Promise<Hex> {
    return this.pub.readContract({ address: this.address, abi: registryAbi, functionName: "getObservationCommitment", args: [cohortKey, assignmentKey, version] });
  }

  isDisclosed(cohortKey: Hex): Promise<boolean> {
    return this.pub.readContract({ address: this.address, abi: registryAbi, functionName: "isDisclosed", args: [cohortKey] });
  }

  private async send(
    functionName: "createCohort" | "registerAssignments" | "freezeRoster" | "anchorObservation" | "closeCohort" | "recordDisclosure" | "voidAssignment",
    args: readonly unknown[],
    onSubmitted?: (hash: Hex) => Promise<void>,
  ): Promise<ConfirmedTx> {
    const { request } = await this.pub.simulateContract({
      address: this.address,
      abi: registryAbi,
      functionName,
      args: args as never,
      account: this.relayer,
    });
    const hash = await this.wallet.writeContract(request);
    if (onSubmitted) await onSubmitted(hash);
    return this.waitFor(hash);
  }

  async waitFor(hash: Hex): Promise<ConfirmedTx> {
    const receipt: TransactionReceipt = await this.pub.waitForTransactionReceipt({ hash, confirmations: this.confirmations, timeout: 180_000 });
    // viem resolves with a replacement's receipt if another tx took this nonce; that is not our transaction.
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error(`transaction ${hash} was replaced`);
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return { txHash: hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
  }

  createCohort(cohortKey: Hex, target: Hex, expected: number, closingAfter: bigint, onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("createCohort", [cohortKey, target, expected, closingAfter], onSubmitted);
  }
  registerAssignments(cohortKey: Hex, keys: Hex[], onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("registerAssignments", [cohortKey, keys], onSubmitted);
  }
  freezeRoster(cohortKey: Hex, onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("freezeRoster", [cohortKey], onSubmitted);
  }
  anchorObservation(cohortKey: Hex, assignmentKey: Hex, version: number, commitment: Hex, onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("anchorObservation", [cohortKey, assignmentKey, version, commitment], onSubmitted);
  }
  closeCohort(cohortKey: Hex, onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("closeCohort", [cohortKey], onSubmitted);
  }
  recordDisclosure(cohortKey: Hex, receiptHash: Hex, onSubmitted?: (h: Hex) => Promise<void>) {
    return this.send("recordDisclosure", [cohortKey, receiptHash], onSubmitted);
  }

  async voidAssignment(cohortKey: Hex, assignmentKey: Hex, reasonDigest: Hex, onSubmitted?: (h: Hex) => Promise<void>) {
    const nonce = await this.pub.readContract({ address: this.address, abi: registryAbi, functionName: "voidApprovalNonces", args: [this.voidApprover.address] });
    const digest = await this.pub.readContract({ address: this.address, abi: registryAbi, functionName: "voidApprovalDigest", args: [cohortKey, assignmentKey, reasonDigest, nonce] });
    const signature = await this.voidApprover.sign({ hash: digest });
    return this.send("voidAssignment", [cohortKey, assignmentKey, reasonDigest, this.voidApprover.address, signature], onSubmitted);
  }

  /** Reads the receipt of a previously submitted tx; null if not mined/known. */
  async tryReceipt(hash: Hex): Promise<ConfirmedTx | null> {
    try {
      const r = await this.pub.getTransactionReceipt({ hash });
      if (r.status !== "success") return null;
      const head = await this.pub.getBlockNumber();
      if (head - r.blockNumber + 1n < BigInt(this.confirmations)) return null;
      // Reorg guard: the block at that height must still be the receipt's block.
      const block = await this.pub.getBlock({ blockNumber: r.blockNumber });
      if (block.hash !== r.blockHash) return null;
      return { txHash: hash, blockNumber: r.blockNumber, blockHash: r.blockHash };
    } catch {
      return null;
    }
  }

  /**
   * Where a previously broadcast transaction stands. "pending" and "unconfirmed" mean wait;
   * only "dropped" makes it safe to broadcast again.
   */
  async txState(hash: Hex): Promise<"pending" | "unconfirmed" | "confirmed" | "reverted" | "dropped"> {
    const receipt = await this.pub.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) {
      if (receipt.status !== "success") return "reverted";
      return (await this.tryReceipt(hash)) ? "confirmed" : "unconfirmed";
    }
    const tx = await this.pub.getTransaction({ hash }).catch(() => null);
    return tx ? "pending" : "dropped";
  }

  /** Finds the transaction that emitted a registry event, for when a tracked hash was lost or superseded. */
  async findEvent(
    eventName: "ObservationAnchored" | "CohortClosed" | "CriterionDisclosureRecorded" | "AssignmentVoided",
    args: { cohortKey: Hex; assignmentKey?: Hex },
    version?: number,
  ): Promise<ConfirmedTx | null> {
    const head = await this.pub.getBlockNumber();
    const span = 40_000n;
    for (let to = head; to >= this.deployBlock; to -= span) {
      const from = to - span + 1n > this.deployBlock ? to - span + 1n : this.deployBlock;
      const logs = await this.pub.getContractEvents({ address: this.address, abi: registryAbi, eventName, args: args as never, fromBlock: from, toBlock: to });
      const matching = version === undefined ? logs : logs.filter((l) => (l.args as { version?: number }).version === version);
      const last = matching[matching.length - 1];
      if (last?.transactionHash) return this.tryReceipt(last.transactionHash);
      if (from === this.deployBlock) break;
    }
    return null;
  }

  async blockStillCanonical(blockNumber: bigint, blockHash: Hex): Promise<boolean> {
    const b = await this.pub.getBlock({ blockNumber });
    return b.hash === blockHash;
  }
}

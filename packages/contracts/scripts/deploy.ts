import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi, registryBytecode } from "../abi";

const rpc = process.env.CHAIN_RPC_URL;
const chainId = Number(process.env.CHAIN_ID);
const deployerKey = (process.env.CHAIN_DEPLOYER_PRIVATE_KEY ?? process.env.CHAIN_RELAYER_PRIVATE_KEY) as Hex | undefined;
const relayerKey = process.env.CHAIN_RELAYER_PRIVATE_KEY as Hex | undefined;
const approverKey = process.env.CHAIN_VOID_APPROVER_PRIVATE_KEY as Hex | undefined;
if (!rpc || !chainId || !deployerKey || !relayerKey || !approverKey) {
  console.error("Required: CHAIN_RPC_URL, CHAIN_ID, CHAIN_RELAYER_PRIVATE_KEY, CHAIN_VOID_APPROVER_PRIVATE_KEY (optional CHAIN_DEPLOYER_PRIVATE_KEY, CHAIN_ADMIN_ADDRESS)");
  process.exit(2);
}

const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const deployer = privateKeyToAccount(deployerKey);
const relayer = privateKeyToAccount(relayerKey).address;
const approver = privateKeyToAccount(approverKey).address;
const admin = (process.env.CHAIN_ADMIN_ADDRESS as Hex | undefined) ?? deployer.address;
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });

const deployHash = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode, args: [admin] });
const receipt = await pub.waitForTransactionReceipt({ hash: deployHash });
const address = receipt.contractAddress!;
console.error(`deployed BlindCountRegistryV1 at ${address} (tx ${deployHash})`);

if (admin.toLowerCase() === deployer.address.toLowerCase()) {
  const grants: Array<[string, Hex]> = [
    ["PUBLISHER_ROLE", relayer],
    ["ANCHOR_ROLE", relayer],
    ["CLOSER_ROLE", relayer],
    ["VOID_ROLE", relayer],
    ["PAUSER_ROLE", admin],
    ["VOID_APPROVER_ROLE", approver],
  ];
  for (const [role, who] of grants) {
    const h = await wallet.writeContract({ address, abi: registryAbi, functionName: "grantRole", args: [keccak256(toHex(role)), who] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.error(`granted ${role} to ${who} (tx ${h})`);
  }
} else {
  console.error(`admin ${admin} is not the deployer: grant roles from the admin wallet.`);
}
console.log(JSON.stringify({ chainId, address, deployTx: deployHash, blockNumber: receipt.blockNumber.toString(), admin, relayer, voidApprover: approver }));

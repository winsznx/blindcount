# Deployments

## Ethereum Sepolia (chain id 11155111)

| | |
|---|---|
| Contract | `BlindCountRegistryV1` |
| Address | [`0x4f38eabf65725d38b4c04410c04318869ae3e8e1`](https://sepolia.etherscan.io/address/0x4f38eabf65725d38b4c04410c04318869ae3e8e1) |
| Deploy block | 11,987,080 |
| Deploy tx | [`0x4302592d…ef762d`](https://sepolia.etherscan.io/tx/0x4302592dd6056c69ece2e0213aa71d4b053423dc8295391e656c9a5e86ef762d) |
| Source | Verified on Sourcify, exact match (creation and runtime bytecode) |
| Compiler | solc 0.8.24, optimizer 200 runs, OpenZeppelin Contracts 5.1.0 |
| Admin | `0x54B72ad20204fae421ba15fA73e1186b4f335a73` (AccessControlDefaultAdminRules, 1-day transfer delay) |
| Relayer | `0x54B72ad20204fae421ba15fA73e1186b4f335a73` (publisher, anchor, closer, void, pauser) |
| Void approver | `0x28e65467D99C2F8bcad62a22ECB9394F02eb6F37` (second signer for voids, EIP-712) |

Role grants:

| Role | Grantee | Tx |
|---|---|---|
| PUBLISHER_ROLE | relayer | [`0x8448412c…f854d4`](https://sepolia.etherscan.io/tx/0x8448412cdf111bcd67e894adc9eb5e4804118b742369edf9dafbe6e44af854d4) |
| ANCHOR_ROLE | relayer | [`0x19147881…733895`](https://sepolia.etherscan.io/tx/0x19147881971f1d95ed4bdddc7fad01a9c0b435f650e245ac74fee53220733895) |
| CLOSER_ROLE | relayer | [`0x3ccca034…e34e88`](https://sepolia.etherscan.io/tx/0x3ccca0344d16ba79a592c373663e50b7ff52328aae3f4f5d9cd3a74ccee34e88) |
| VOID_ROLE | relayer | [`0x4e2a9d09…d51029`](https://sepolia.etherscan.io/tx/0x4e2a9d0915e84edab7797c7fb730560e8614279b7390f10ebb7c11f041d51029) |
| PAUSER_ROLE | admin | [`0x301b9d07…b03c6`](https://sepolia.etherscan.io/tx/0x301b9d07e9198eb2a2b745c8002cbb45ebe19bd4e46c4f736c54f919149b03c6) |
| VOID_APPROVER_ROLE | void approver | [`0xf7c12c4a…48c1e5`](https://sepolia.etherscan.io/tx/0xf7c12c4a534d25d21037f475e256ba391e6ff1148f0de990f5cb02319048c1e5) |

API environment for this deployment: `CHAIN_ID=11155111`, `CHAIN_REGISTRY_ADDRESS` as above, `CHAIN_REGISTRY_DEPLOY_BLOCK=11987080`, `CHAIN_CONFIRMATIONS=3`, `CHAIN_EXPLORER_URL=https://sepolia.etherscan.io`, `CHAIN_PUBLIC_RPC_HINT=https://ethereum-sepolia-rpc.publicnode.com`.

Reproduce the deployment: `pnpm contracts:deploy:testnet` with a funded key in `.env.testnet` (see [RUNBOOK.md](RUNBOOK.md)).

// We hash and sign (address+amount+blocknum+contractaddr)
// This means one address can bridge once per block
// We could use trxid for uniqueness instead of blocknum but that takes more storage (gas)

import { encodePacked, keccak256 } from '@wevm/viem/utils'

// Include contract address to avoid multi contract replay attacks
export const hashWrapMessage = (
	address: `0x${string}`,
	amount: number,
	blockNum: number,
	contract: `0x${string}`,
) => {
	return keccak256(
		encodePacked(
			['address', 'string', 'uint64', 'string', 'uint32', 'string', 'address'],
			[address, ';', BigInt(amount), ';', blockNum, ';', contract],
		),
	)
}

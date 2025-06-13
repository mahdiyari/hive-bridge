import { ethers } from 'ethers'

// We hash and sign (address+amount+blocknum+contractaddr)
// This means one address can bridge once per block
// We could use trxid for uniqueness instead of blocknum but that takes more storage (gas)
// Include contract address to avoid multi contract replay attacks
export const hashWrapMessage = (
	address: string,
	amount: number,
	blockNum: number,
	contract: string,
) => {
	return ethers.keccak256(
		ethers.solidityPacked(
			['address', 'string', 'uint64', 'string', 'uint32', 'string', 'address'],
			[address, ';', amount, ';', blockNum, ';', contract],
		),
	)
}

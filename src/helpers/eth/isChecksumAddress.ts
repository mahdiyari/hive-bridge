import { checksumAddress, isAddress } from '@wevm/viem'

export const isChecksumAddress = (addr: string) => {
	if (!isAddress(addr)) {
		return false
	}
	if (checksumAddress(addr) !== addr) {
		return false
	}
	return true
}

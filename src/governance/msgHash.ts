import { ChainService } from '@/types/chain.types'
import { Proposal } from './Proposal'
import { getPublicActiveKeys } from '@/utils/hive.utils'

export const getChainMessageHash = async (
  chain: ChainService,
  proposal: Proposal,
  sign = false
): Promise<string> => {
  let hash = ''
  switch (proposal.method) {
    case 'add-signer':
      const pubKeys = await getPublicActiveKeys(proposal.target)
      const address = chain.toAddress(pubKeys[0])
      hash = await chain.hashAddSignerMsg(
        proposal.target,
        address,
        proposal.nonce
      )
      break
    case 'remove-signer':
      hash = await chain.hashRemoveSignerMsg(proposal.target, proposal.nonce)
      break
    case 'update-threshold':
      hash = await chain.hashUpdateMultisigThresholdMsg(
        Number(proposal.target),
        proposal.nonce
      )
      break
    case 'pause':
      hash = await chain.hashPauseMsg(proposal.nonce)
      break
    case 'unpause':
      hash = await chain.hashUnPauseMsg(proposal.nonce)
      break
  }
  return sign ? chain.signMsgHash(hash) : hash
}

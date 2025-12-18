import { ChainService } from '@/types/chain.types'
import { Proposal } from './Proposal'
import { getPublicActiveKeys } from '@/utils/hive.utils'

export const getChainMessageHash = async (
  chain: ChainService,
  proposal: Proposal,
  sig = false
): Promise<string> => {
  let hash = ''
  switch (proposal.method) {
    case 'add-signer':
      const pubKeys = await getPublicActiveKeys(proposal.target!)
      const address = chain.toAddress(pubKeys[0])
      hash = await chain.hashAddSignerMsg(proposal.target!, address)
      break
    case 'remove-signer':
      hash = await chain.hashRemoveSignerMsg(proposal.target!)
      break
    case 'update-threshold':
      hash = await chain.hashUpdateMultisigThresholdMsg(Number(proposal.target))
      break
    case 'pause':
      hash = await chain.hashPauseMsg()
      break
    case 'unpause':
      hash = await chain.hashUnPauseMsg()
      break
  }
  return sig ? chain.signMsgHash(hash) : hash
}

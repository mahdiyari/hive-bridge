import { EventDetail } from './types'
import { p2pNetwork } from '../P2PNetwork'

let pendingListens: ((msg: EventDetail) => void)[] = []

export const listener = (cb: (msg: EventDetail) => void) => {
  pendingListens.push(cb)
}

// Add listeners to an array and add them to the p2pNetwork instance after it is initialized
const myInterval = setInterval(() => {
  if (p2pNetwork) {
    for (let i = 0; i < pendingListens.length; i++) {
      p2pNetwork.onMessage(pendingListens[i])
    }
    pendingListens = []
    clearInterval(myInterval)
  }
}, 500)

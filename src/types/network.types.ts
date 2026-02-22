import { FullMessage } from '@/network/zodSchemas'

// Create a custom event for redirecting the peer messages to the main app
// All peers will dispatch this event onmessage
export type EventDetail = {
  type: string
  data: FullMessage
  sender: string
}
export interface PeerMessageEvent extends CustomEvent {
  detail: EventDetail
}

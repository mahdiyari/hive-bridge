import { logger } from './logger'

interface IP {
  ip: string
}

/**
 * Get the public IP address of this node using ipify.org
 * Tries IPv4 first, then IPv6, falls back to 'none' if both fail
 */
export const getMyIP = async (): Promise<IP> => {
  try {
    const result4 = await fetch('https://api4.ipify.org?format=json')
    const ip4 = await result4.json()
    if (
      ip4 &&
      typeof ip4 === 'object' &&
      'ip' in ip4 &&
      typeof ip4.ip === 'string'
    ) {
      return { ip: ip4.ip }
    }
    const result6 = await fetch('https://api6.ipify.org?format=json')
    const ip6 = await result6.json()
    if (
      ip6 &&
      typeof ip6 === 'object' &&
      'ip' in ip6 &&
      typeof ip6.ip === 'string'
    ) {
      return { ip: ip6.ip }
    }
    return { ip: 'none' }
  } catch (error) {
    logger.error('Failed to fetch public IP:', error)
    return { ip: 'none' }
  }
}

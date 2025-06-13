interface IP {
  ip: string
}

export const getMyIp = async (): Promise<IP> => {
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
  } catch {
    return { ip: 'none' }
  }
}

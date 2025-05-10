interface IP {
	ip: string
}

export const getMyIp = async (): Promise<IP> => {
	try {
		const result4 = await fetch('https://api4.ipify.org?format=json')
		const ip4 = await result4.json()
		if (typeof ip4 === 'object' && Object.hasOwn(ip4, 'ip')) {
			return ip4
		}
		const result6 = await fetch('https://api6.ipify.org?format=json')
		const ip6 = await result6.json()
		if (typeof ip6 === 'object' && Object.hasOwn(ip6, 'ip')) {
			return ip6
		}
		return { ip: 'none' }
	} catch {
		return { ip: 'none' }
	}
}

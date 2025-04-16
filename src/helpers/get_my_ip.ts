interface IP {
	ip: string
}

export const getMyIp = async (): Promise<IP> => {
	try {
		const result = await fetch('https://api64.ipify.org?format=json')
		const ip = await result.json()
		if (typeof ip === 'object' && Object.hasOwn(ip, 'ip')) {
			return ip
		}
		return { ip: 'none' }
	} catch {
		return { ip: 'none' }
	}
}

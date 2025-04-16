export const generateSelfSignedCert = async () => {
	// Create a command to run OpenSSL
	const openSslCommand = new Deno.Command('openssl', {
		args: [
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			'/dev/stdout',
			'-out',
			'/dev/stdout',
			'-days',
			'3650',
			'-subj',
			'/CN=localhost/O=Deno Self Signed',
		],
		stdout: 'piped',
	})

	// Run the command
	const { stdout } = await openSslCommand.output()
	const output = new TextDecoder().decode(stdout)

	// Split the output to get both the key and certificate
	const keyMatch = output.match(
		/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
	)
	const certMatch = output.match(
		/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
	)

	if (!keyMatch || !certMatch) {
		throw new Error('Failed to generate certificate or key')
	}

	const key = `-----BEGIN PRIVATE KEY-----${
		keyMatch[1]
	}-----END PRIVATE KEY-----`
	const cert = `-----BEGIN CERTIFICATE-----${
		certMatch[1]
	}-----END CERTIFICATE-----`

	return { cert, key }
}

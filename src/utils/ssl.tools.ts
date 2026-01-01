import { spawn } from 'child_process'

/**
 * Generate a self-signed certificate using OpenSSL - AI generated
 */
export function generateSelfSignedCert(): Promise<{
  key: string
  cert: string
}> {
  return new Promise((resolve, reject) => {
    const openssl = spawn('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '3650',
      '-subj',
      '/CN=localhost',
      '-keyout',
      '-', // stdout
      '-out',
      '-', // stdout
    ])
    let stdout = ''
    let stderr = ''
    openssl.stdout.on('data', (d) => (stdout += d))
    openssl.stderr.on('data', (d) => (stderr += d))
    openssl.on('error', () => {
      throw new Error('Make sure openssl is installed on the system')
    })
    openssl.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr))
      }
      const key = stdout.match(
        /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/
      )?.[0]
      const cert = stdout.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
      )?.[0]
      if (!key || !cert) {
        return reject(new Error('Failed to extract key or certificate'))
      }
      resolve({ key, cert })
    })
  })
}

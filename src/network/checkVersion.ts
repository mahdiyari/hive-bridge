import { config } from '@/core/config'
import semver from 'semver'

/** Handle potential breaking upgrades here */
export const checkVersion = (version: string) => {
  // Reject anything lower than 1.0.0-beta.2
  if (semver.lt(version, '1.0.0-beta.2')) {
    return false
  }
  return true
}

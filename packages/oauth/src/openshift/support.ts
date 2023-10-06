import { relToAbsUrl } from '../utils/utils'
import { log, UserProfile } from '../globals'
import { EXPIRES_IN_KEY, OBTAINED_AT_KEY, OpenShiftOAuthConfig, TokenMetadata } from './globals'

const OS_TOKEN_STORAGE_KEY = 'osAuthCreds'

export function currentTimeSeconds(): number {
  return Math.floor(new Date().getTime() / 1000)
}

export function buildUserInfoUri(masterUri: string, config: OpenShiftOAuthConfig): string {
  let uri: URL
  if (masterUri) {
    uri = new URL(relToAbsUrl(masterUri) + '/apis/user.openshift.io/v1/users/~')
  } else {
    uri = new URL(`${config.oauth_authorize_uri}/apis/user.openshift.io/v1/users/~`)
  }

  return uri.toString()
}

function forceRelogin(url: URL, config: OpenShiftOAuthConfig) {
  clearTokenStorage()
  doLogin(config, { uri: url.toString() })
}

export function doLogout(config: OpenShiftOAuthConfig): void {
  const currentURI = new URL(window.location.href)
  // The following request returns 403 when delegated authentication with an
  // OAuthClient is used, as possible scopes do not grant permissions to access the OAuth API:
  // See https://github.com/openshift/origin/issues/7011
  //
  // So little point in trying to delete the token. Lets do in client-side only
  //
  forceRelogin(currentURI, config)
}

export function doLogin(config: OpenShiftOAuthConfig, options: { uri: string }): void {
  if (!config) {
    log.debug('Cannot login due to config now being properly defined')
    return
  }

  const clientId = config.oauth_client_id
  const targetURI = config.oauth_authorize_uri
  const scope = config.scope

  const uri = new URL(targetURI as string)

  /**
   * The authorization uri uses the searchParams for holding
   * the parameters while the token response uri returns the token
   * and metadata in the hash
   */
  uri.searchParams.append('client_id', clientId)
  uri.searchParams.append('response_type', 'token')
  uri.searchParams.append('state', options.uri)
  uri.searchParams.append('redirect_uri', options.uri)
  uri.searchParams.append('scope', scope)

  const target = uri.toString()
  log.debug('Redirecting to URI:', target)

  // Redirect to the target URI
  window.location.href = target
}

function extractToken(uri: URL): TokenMetadata | null {
  log.debug('Extract token from URI - query:', uri.search, 'hash: ', uri.hash)

  //
  // Error has occurred on the lines of a scoping denied
  //
  const searchParams = new URLSearchParams(uri.search)
  if (searchParams.has('error')) {
    throw new Error(searchParams.get('error_description') || searchParams.get('error_description') || 'unknown login error occurred')
  }

  const fragmentParams = new URLSearchParams(uri.hash.substring(1))

  log.debug('Extract token from URI - fragmentParams:', fragmentParams)
  if (
    !fragmentParams.has('access_token') ||
    (fragmentParams.get('token_type') !== 'bearer' && fragmentParams.get('token_type') !== 'Bearer')
  ) {
    log.debug('No token in URI')
    return null
  }

  log.debug('Got token')
  const credentials: TokenMetadata = {
    token_type: fragmentParams.get('token_type') || '',
    access_token: fragmentParams.get('access_token') || '',
    expires_in: parseInt(fragmentParams.get('expires_in') || '') || 0,
    obtainedAt: currentTimeSeconds(),
  }
  localStorage.setItem(OS_TOKEN_STORAGE_KEY, JSON.stringify(credentials))

  fragmentParams.delete('token_type')
  fragmentParams.delete('access_token')
  fragmentParams.delete('expires_in')
  fragmentParams.delete('scope')
  fragmentParams.delete('state')

  uri.hash = fragmentParams.toString()

  const target = uri.toString()
  log.debug('redirecting to:', target)

  // Redirect to new location
  window.location.href = target

  return credentials
}

export function clearTokenStorage(): void {
  localStorage.removeItem(OS_TOKEN_STORAGE_KEY)
}

export function tokenHasExpired(profile: UserProfile): boolean {
  // if no token metadata then remaining will end up as (-1 - now())
  let remaining = -1
  if (!profile) return true // no profile so no oken

  if (!profile.getToken()) return true // no token then must have expired!

  const obtainedAt = profile.metadataValue<number>(OBTAINED_AT_KEY) || 0
  const expiry = profile.metadataValue<number>(EXPIRES_IN_KEY) || 0
  if (obtainedAt) {
    remaining = obtainedAt + expiry - currentTimeSeconds()
  }

  return remaining <= 0
}

export function checkToken(uri: URL): TokenMetadata | null {
  let answer: TokenMetadata | null = null

  const tokenJson = localStorage.getItem(OS_TOKEN_STORAGE_KEY)

  if (tokenJson) {
    try {
      answer = JSON.parse(tokenJson)
    } catch (e) {
      clearTokenStorage()
      throw new Error('Error extracting osAuthCreds value:', { cause: e })
    }
  }

  if (!answer) {
    log.debug('Extracting token from uri', answer)
    try {
      answer = extractToken(uri)
    } catch (e) {
      clearTokenStorage()
      throw e
    }
  }

  log.debug('Using extracted credentials:', answer)
  return answer
}
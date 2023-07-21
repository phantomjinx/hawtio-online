import { Logger } from '@hawtio/react'

export const moduleName = 'hawtio-oauth'
export const log = Logger.get(moduleName)

export class UserProfile {
  private id: string // which type of oauth is the profile, eg. google, openshift, github
  private masterUri?: string
  private token?: string
  private error: Error|null = null

  constructor(id: string) {
    this.id = id
  }

  getId() {
    return this.id
  }

  isActive(): boolean {
    return this.getToken().length > 0 || this.hasError()
  }

  getToken(): string {
    return this.token ? this.token : ''
  }

  setToken(token: string) {
    this.token = token
  }

  getMasterUri(): string {
    return this.masterUri ? this.masterUri : ''
  }

  setMasterUri(masterUri: string) {
    this.masterUri = masterUri
  }

  hasError() {
    return this.error !== null
  }

  getError() {
    return this.error
  }

  setError(error: Error) {
    this.error = new Error("Openshift OAuth Error", { cause: error})
    log.error(error)
  }
}

import Jolokia, { IJolokia, IListOptions, IOptions, ISearchOptions, ISimpleOptions, IVersion, IVersionOptions } from 'jolokia.js'
import $ from 'jquery'
import { log } from './globals'
import jsonpath from 'jsonpath'
import { func, is, object } from 'superstruct'
import { k8Api, KubePod, k8Service, ObjectMeta, PodStatus, joinPaths, PodSpec, isString, isObject } from '@hawtio/online-kubernetes-api'

const DEFAULT_JOLOKIA_OPTIONS: IOptions = {
  method: 'POST',
  mimeType: 'application/json',
  canonicalNaming: false,
  canonicalProperties: false,
  ignoreErrors: true,
} as const

/**
 * Dummy Jolokia implementation that does nothing.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
class DummyJolokia implements IJolokia {
  isDummy = true
  private running = false

  request(...args: unknown[]) {
    return null
  }

  getAttribute(mbean: string, attribute: string, path?: string | ISimpleOptions, opts?: ISimpleOptions) {
    opts?.success?.({})
    return null
  }
  setAttribute(
    mbean: string,
    attribute: string,
    value: unknown,
    path?: string | ISimpleOptions,
    opts?: ISimpleOptions,
  ) {
    opts?.success?.({})
  }

  execute(mbean: string, operation: string, ...args: unknown[]) {
    args?.forEach(arg => is(arg, object({ success: func() })) && arg.success?.(null))
    return null
  }
  search(mBeanPattern: string, opts?: ISearchOptions) {
    opts?.success?.([])
    return null
  }
  list(path: string, opts?: IListOptions) {
    opts?.success?.({})
    return null
  }
  version(opts?: IVersionOptions) {
    opts?.success?.({} as IVersion)
    return {} as IVersion
  }

  register(params: unknown, ...request: unknown[]) {
    return 0
  }
  unregister(handle: number) {
    /* no-op */
  }
  jobs() {
    return []
  }
  start(period: number) {
    this.running = true
  }
  stop() {
    this.running = false
  }
  isRunning() {
    return this.running
  }
}

export type Management = {
  status: {
    running: boolean,
    error: boolean
  },
  camel: {
    routes_count: number
  }
}

export class ManagedPod {
  static readonly DEFAULT_JOLOKIA_PORT = 8778

  readonly jolokiaPort: number
  readonly jolokiaPath: string
  readonly jolokia: IJolokia

  private _management: Management = {
    status: {
      running: false,
      error: false
    },
    camel: {
      routes_count: 0
    }
  }

  constructor(public pod: KubePod) {
    this.jolokiaPort = this.extractPort(pod)
    this.jolokiaPath = ManagedPod.getJolokiaPath(pod, this.jolokiaPort) || ''
    this.jolokia = this.createJolokia() || new DummyJolokia()
  }

  static getAnnotation(pod: KubePod, name: string, defaultValue: string): string {
    if (pod.metadata?.annotations && pod.metadata?.annotations[name]) {
      return pod.metadata.annotations[name]
    }
    return defaultValue
  }

  static getJolokiaPath(pod: KubePod, port: number): string | null {
    if (! k8Api.masterUri()) {
      return null
    }

    if (!pod.metadata) {
      log.error("Cannot get jolokia path for pod as it does not contain any metadata properties")
      return null
    }

    const namespace = pod.metadata?.namespace
    const name = pod.metadata?.name
    const protocol = ManagedPod.getAnnotation(pod, 'hawt.io/protocol', 'https')
    const jolokiaPath = ManagedPod.getAnnotation(pod, 'hawt.io/jolokiaPath', '/jolokia/')
    const path = `/management/namespaces/${namespace}/pods/${protocol}:${name}:${port}${jolokiaPath}`
    return joinPaths(window.location.origin, path)

    // TODO:
    //
    // This was originally /management/...
    // This location is governed by the nginx conf location of /management
    // which passes the thing to the jolokiaAgent client
    // So ... ... ...
    // Do we add a similar rule and keep this as /master/api/v1.... or
    // do we change this to /managment.
    // If 1 then have to add location rule
    // If 2 then have to add alias to devServer
    //
    // ... ... ...
    // Trying out 2 and seeing if something different happens
    // ... bump-in-road -> docker run out of space
  }

  private extractPort(pod: KubePod): number {
    const ports = jsonpath.query(pod, k8Service.jolokiaPortQuery)
    if (!ports || ports.length === 0) return ManagedPod.DEFAULT_JOLOKIA_PORT
    return ports[0].containerPort || ManagedPod.DEFAULT_JOLOKIA_PORT
  }

  private createJolokia() {
    if (! this.jolokiaPath || this.jolokiaPath.length === 0) {
      log.error(`Failed to find jolokia path for pod ${this.pod.metadata?.uid}`)
      return
    }

    const options = { ...DEFAULT_JOLOKIA_OPTIONS }
    options.url = this.jolokiaPath

    return new Jolokia(options)
  }

  get kind(): string | undefined {
    return this.pod.kind
  }

  get metadata(): ObjectMeta | undefined {
    return this.pod.metadata
  }

  get spec(): PodSpec | undefined {
    return this.pod.spec
  }

  get status(): PodStatus | undefined {
    return this.pod.status
  }

  get management(): Management {
    return this._management
  }

  async probeJolokiaUrl(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      $.ajax({
          url: `${this.jolokiaPath}version`,
          method: 'GET',
          dataType: 'text'
        })
        .done((data: string, textStatus: string, xhr: JQueryXHR) => {
          if (xhr.status !== 200) {
            console.log("Status is not 200: " + xhr.status)
            reject()
            return
          }

          try {
            if (isString(data)) {
              console.log("DATA IS DEFINITELY A STRING")
            } else if (isObject(data)) {
              console.log("DATA IS DEFINITELY AN OBJECT")
            } else {
              console.log("DATA IS DEFINITELY SOMETHING ELSE")
            }

            console.log(data)
            const resp = JSON.parse(data)
            if ('error' in resp) {
              throw new Error(resp.error)
            }

            if ('value' in resp && 'agent' in resp.value) {
              log.debug('Found jolokia agent at:', this.jolokiaPath, 'version:', resp.value.agent)
              resolve(this.jolokiaPath)
              return
            } else {
              throw new Error('Detected jolokia but cannot determine agent or version')
            }

          } catch (e) {
            // Parse error should mean redirect to html
            reject(e)
            return
          }
        })
        .fail((xhr: JQueryXHR, _: string, error: string) => {
          if (error) {
            reject(`Jolokia Probe Error: ${error}`)
          }

          reject(`${xhr.status} ${xhr.statusText}`)
        })
    })
  }
}
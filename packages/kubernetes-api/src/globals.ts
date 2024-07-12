import { Logger } from '@hawtio/react'
import { NamespaceSpec, NamespaceStatus, Pod } from 'kubernetes-types/core/v1'
import { ListMeta, ObjectMeta } from 'kubernetes-types/meta/v1'
import { hasProperty } from './utils'

export const pluginName = 'hawtio-online-k8s-api'
export const log = Logger.get(pluginName)

export const K8S_PREFIX = 'api'
export const OS_PREFIX = 'apis'
export const K8S_EXT_PREFIX = 'apis/extensions'

export const K8S_API_VERSION = 'v1'
export const OS_API_VERSION = 'v1'
export const K8S_EXT_VERSION = 'v1beta1'

export interface KubeOwnerRef {
  apiVersion: string
  kind: string
  name: string
  uid: string
  controller: boolean
  blockOwnerDeletion: boolean
}

export interface KubeObject extends Record<string, unknown> {
  kind?: string
  metadata?: ObjectMeta
  spec?: unknown
}

export interface KubeObjectList<T extends KubeObject> {
  kind?: string
  metadata: ListMeta
  items: T[]
}

export interface KLimitMetadata {
  remaining: number
  continue?: string
}

export type KubePod = Pod & KubeObject

export type KubeProject = KubeObject & {
  apiVersion: 'project.openshift.io/v1'
  spec?: NamespaceSpec
  status?: NamespaceStatus
}

export type KubePodsByProject = { [key: string]: KubePod[] }

export class PagingMetadata {
  private pagingRefs: KLimitMetadata[] = []
  private _current: number = 0

  get current() {
    return this._current
  }

  addPagingRef(remaining: number, continueRef?: string) {
    if (! continueRef)
      this.pagingRefs.push({ remaining: remaining })
    else
      this.pagingRefs.push({ remaining: remaining, continue: continueRef })
  }

  setCurrentRemaining(remaining: number) {
    if (this.pagingRefs.length <= this._current)
      return // Should not happen. TODO how to log error condition?

    const currRef = this.pagingRefs[this._current]
    currRef.remaining = remaining
  }

  previousRemaining(): number {
    if (this._current === 0) return 0

    const prevMetadata = this.pagingRefs[this._current - 1]
    return prevMetadata.remaining
  }

  currentRemaining(): number {
    if (this.pagingRefs.length <= this._current) return 0

    const currMetadata = this.pagingRefs[this._current]
    return currMetadata.remaining
  }

  hasCurrentContinueRef(): boolean {
    if (this.pagingRefs.length <= this._current) return false

    const currMetadata = this.pagingRefs[this._current]
    return hasProperty(currMetadata, 'continue')
  }

  currentContinueRef(): string|undefined {
    if (this.pagingRefs.length <= this._current) return undefined

    const currMetadata = this.pagingRefs[this._current]
    return currMetadata.continue
  }

  setNextContinueRef(continueRef: string | undefined) {
    if (! continueRef) return // Nothing to do

    if (this.pagingRefs.length <= this._current + 1)
      return // Should not happen. TODO how to log error condition?

    const nextRef = this.pagingRefs[this._current + 1]
    nextRef.continue = continueRef
  }

  decrementCurrent() {
    if (this._current === 0) return // TODO log error condition
    --this._current
  }

  incrementCurrent() {
    if (this._current === (this.pagingRefs.length - 1)) return // TODO log error condition
    ++this._current
  }
}

export type KMetadataByProject = { [key: string]: PagingMetadata }

/*
 * States emitted by the Kubernetes Service
 */
export enum K8Actions {
  CHANGED = 'CHANGED',
}

export type {
  NamespaceSpec,
  NamespaceStatus,
  Pod,
  PodCondition,
  PodSpec,
  PodStatus,
  Container,
  ContainerPort,
  ContainerStatus,
} from 'kubernetes-types/core/v1'
export type { ObjectMeta, OwnerReference } from 'kubernetes-types/meta/v1'

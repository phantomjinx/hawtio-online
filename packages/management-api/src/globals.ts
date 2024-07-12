import { Logger } from '@hawtio/react'
import { ManagedPod } from './managed-pod'

export const pluginName = 'hawtio-online-management-api'
export const log = Logger.get(pluginName)

/*
 * States emitted by the Management Service
 */
export enum MgmtActions {
  UPDATED = 'UPDATED',
}

export type MPodsByUid = { [uid: string]: ManagedPod }
export type MPodsByProject = { [key: string]: MPodsByUid }

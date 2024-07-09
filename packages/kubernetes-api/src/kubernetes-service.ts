import { configManager, Hawtconfig } from '@hawtio/react'
import EventEmitter from 'eventemitter3'
import {
  HawtioMode,
  HAWTIO_MODE_KEY,
  HAWTIO_NAMESPACE_KEY,
  CLUSTER_VERSION_KEY,
  UserProfile,
  getActiveProfile,
} from '@hawtio/online-oauth'
import jsonpath from 'jsonpath'
import { WatchTypes } from './model'
import { pathGet } from './utils'
import { clientFactory, Collection, KOptions, log, ProcessDataCallback } from './client'
import { K8Actions, KubeObject, KubePod, KubeProject } from './globals'
import { k8Api } from './init'

export interface Client<T extends KubeObject> {
  collection: Collection<T>
  watch: ProcessDataCallback<T>
}

class ProjectBookmark {

  private seenProjects = new Set()
  private _current: string = ''
  private _continueRef: string = ''

  constructor(private _podsRemaining: number) {}

  hasSeen(project: KubeProject): boolean {
    return this.seenProjects.has(project.metadata?.uid)
  }

  seen(project: KubeProject) {
    this.seenProjects.add(project.metadata?.uid)
  }

  isCurrent(project: KubeProject): boolean {
    return this._current === project.metadata?.uid
  }

  set current(project: KubeProject) {
    this._current = project.metadata?.uid ?? ''
  }

  get continueRef(): string {
    return this._continueRef
  }

  set continueRef(reference: string) {
    this._continueRef = reference
  }

  get podsRemaining(): number {
    return this._podsRemaining
  }

  reducePods(pods: number) {
    console.log(`Reducing pods by ${pods}`)
    const r = this._podsRemaining - pods
    this._podsRemaining = r < 0 ? 0 : r
  }

  print(): string {
    return `seenProjects: ${this.seenProjects.toString()}, current: ${this._current},  continueRef: ${this.continueRef}`
  }
}

export class KubernetesService extends EventEmitter {
  private readonly _jolokiaPortQuery = '$.spec.containers[*].ports[?(@.name=="jolokia")]'
  private _loading = 0
  private _initialized = false
  private _error: Error | null = null
  private _oAuthProfile: UserProfile | null = null
  private projects: KubeProject[] = []
  private pods: KubePod[] = []
  private projects_client: Client<KubeProject> | null = null
  private pods_clients: { [key: string]: Client<KubePod> } = {}

  private _nsLimit = 3

  private projectBookmark: ProjectBookmark = new ProjectBookmark(this._nsLimit)

  async initialize(): Promise<boolean> {
    if (this._initialized) return this._initialized

    try {
      this._oAuthProfile = await getActiveProfile()
      if (!this._oAuthProfile) throw new Error('Cannot initialize k8 API due to no active OAuth profile')

      if (this._oAuthProfile.hasError()) throw this._oAuthProfile.getError()

      const isCluster = this.is(HawtioMode.Cluster)
      if (isCluster) {
        const hawtConfig = await configManager.getHawtconfig()
        this.initClusterConfig(hawtConfig)
      } else {
        this.initNamespaceConfig(this._oAuthProfile)
      }

      this._initialized = true
    } catch (error) {
      log.error('k8 Service cannot complete initialisation due to: ', error)
      if (error instanceof Error) this._error = error
      else this._error = new Error('Unknown error during initialisation')
    }

    this._initialized = true
    return this._initialized
  }

  private initNamespaceConfig(profile: UserProfile) {
    log.debug('Initialising Namespace Config')
    this._loading++
    let namespace = profile.metadataValue<string>(HAWTIO_NAMESPACE_KEY)
    if (!namespace) {
      log.warn("No namespace can be found - defaulting to 'default'")
      namespace = 'default'
    }
    const pods_client = clientFactory.create<KubePod>({ kind: WatchTypes.PODS, namespace: namespace, nsLimit: this._nsLimit })
    const pods_watch = pods_client.watch(pods => {
      this._loading--
      this.pods.splice(0, this.pods.length) // clear the array
      const jolokiaPods = pods.filter(pod => jsonpath.query(pod, this.jolokiaPortQuery).length > 0)
      this.pods.push(...jolokiaPods)
      this.emit(K8Actions.CHANGED)
    })

    this.pods_clients[namespace] = { collection: pods_client, watch: pods_watch }
    pods_client.connect()
  }

  private initClusterConfig(hawtConfig: Hawtconfig) {
    log.debug('Initialising Cluster Config')
    const kindToWatch = k8Api.isOpenshift ? WatchTypes.PROJECTS : WatchTypes.NAMESPACES
    const labelSelector = pathGet(hawtConfig, ['online', 'projectSelector']) as string
    const projects_client = clientFactory.create<KubeProject>({
      kind: kindToWatch,
      labelSelector: labelSelector
    })

    this._loading++
    const projects_watch = projects_client.watch(projects => {
      // subscribe to pods update for new projects
      let filtered = projects.filter(project => !this.projects.some(p => p.metadata?.uid === project.metadata?.uid))
      for (const project of filtered) {

        //
        // If the project has already been seen by the bookmark
        // and is not the current project that the continue ref
        // is located in then ignore the project
        //
        if (this.projectBookmark.hasSeen(project) && ! this.projectBookmark.isCurrent(project))
          continue

        //
        // Reached the limit of pods to return
        //
        if (this.projectBookmark.podsRemaining === 0) {
          console.log(this.projectBookmark.print())
          continue
        }

        this._loading++

        const podOptions: KOptions = {
          kind: WatchTypes.PODS,
          namespace: project.metadata?.name,
          nsLimit: this.projectBookmark.podsRemaining
        }

        if (this.projectBookmark.isCurrent(project) && this.projectBookmark.continueRef !== null) {
          //
          // If the bookmark contains a continueRef then add it in
          // to retrieve the rest of the pods in the project
          //
          podOptions.continueRef = this.projectBookmark.continueRef
        }

        const pods_client = clientFactory.create<KubePod>(podOptions)

        if (pods_client.continueRef !== null) {
          //
          // Limit has been reached halfway through a project
          // so store the current project and the continue reference
          //
          this.projectBookmark.current = project
          this.projectBookmark.continueRef = pods_client.continueRef
        } else {
          //
          // All pods in this project have been returned
          //
          this.projectBookmark.seen(project)
        }

        const pods_watch = pods_client.watch(pods => {
          this._loading--
          const others = this.pods.filter(pod => pod.metadata?.namespace !== project.metadata?.name)

          // clear pods
          this.pods.splice(0, this.pods.length)

          // add others back to pods
          this.pods.push(...others)

          const jolokiaPods = pods.filter(pod => jsonpath.query(pod, this.jolokiaPortQuery).length > 0)

          for (const jpod of jolokiaPods) {
            const pos = this.pods.findIndex(pod => pod.metadata?.uid === jpod.metadata?.uid)
            if (pos > -1) {
              // replace the pod - not sure we need to ...?
              this.pods.splice(pos, 1)
            }

            this.pods.push(jpod)
          }

          //
          // Calculate how many pods are left to list
          //
          console.log('Calculating how many pods are left to list')
          this.projectBookmark.reducePods(this.pods.length)

          this.emit(K8Actions.CHANGED)
        })

        this.pods_clients[project.metadata?.name as string] = {
          collection: pods_client,
          watch: pods_watch,
        }

        console.log('Calling pods_client.connect()')
        pods_client.connect()


      }

      // handle delete projects
      filtered = this.projects.filter(project => !projects.some(p => p.metadata?.uid === project.metadata?.uid))
      for (const project of filtered) {
        const handle = this.pods_clients[project.metadata?.name as string]
        clientFactory.destroy(handle.collection, handle.watch)
        delete this.pods_clients[project.metadata?.name as string]
      }

      this.projects.splice(0, this.projects.length) // clear the array
      this.projects.push(...projects)
      this._loading--
    })

    this.projects_client = { collection: projects_client, watch: projects_watch }
    projects_client.connect()
  }

  get initialized(): boolean {
    return this._initialized
  }

  private checkInitOrError() {
    if (!this.initialized) throw new Error('k8 Service is not intialized')

    if (this.hasError()) throw this._error

    if (!this._oAuthProfile) throw new Error('Cannot find the oAuth profile')

    if (this._oAuthProfile.hasError()) throw this._oAuthProfile.getError()
  }

  get loading() {
    return this._loading
  }

  isLoading(): boolean {
    return this._loading > 0
  }

  hasError() {
    return this._error !== null
  }

  get error(): Error | null {
    return this._error
  }

  get jolokiaPortQuery() {
    return this._jolokiaPortQuery
  }

  get namespaceLimit() {
    return this._nsLimit
  }

  set namespaceLimit(limit: number) {
    this._nsLimit = limit
  }

  is(mode: HawtioMode): boolean {
    return mode === this._oAuthProfile?.metadataValue(HAWTIO_MODE_KEY)
  }

  getPods(): KubePod[] {
    this.checkInitOrError()
    return this.pods
  }

  getProjects(): KubeProject[] {
    this.checkInitOrError()
    return this.projects
  }

  getClusterVersion(): string | undefined {
    this.checkInitOrError()
    return this._oAuthProfile?.metadataValue(CLUSTER_VERSION_KEY)
  }

  disconnect() {
    this.checkInitOrError()
    if (this.is(HawtioMode.Cluster) && this.projects_client) {
      clientFactory.destroy(this.projects_client.collection, this.projects_client.watch)
    }

    Object.values(this.pods_clients).forEach(client => {
      clientFactory.destroy(client.collection, client.watch)
    })
  }

  podStatus(pod: KubePod): string {
    // Return results that match
    // https://github.com/openshift/origin/blob/master/vendor/k8s.io/kubernetes/pkg/printers/internalversion/printers.go#L523-L615

    if (!pod || (!pod.metadata?.deletionTimestamp && !pod.status)) {
      return ''
    }

    if (pod.metadata?.deletionTimestamp) {
      return 'Terminating'
    }

    let initializing = false
    let reason

    // Print detailed container reasons if available. Only the first will be
    // displayed if multiple containers have this detail.

    const initContainerStatuses = pod.status?.initContainerStatuses || []
    for (const initContainerStatus of initContainerStatuses) {
      const initContainerState = initContainerStatus['state']
      if (!initContainerState) continue

      if (initContainerState.terminated && initContainerState.terminated.exitCode === 0) {
        // initialization is complete
        break
      }

      if (initContainerState.terminated) {
        // initialization is failed
        if (!initContainerState.terminated.reason) {
          if (initContainerState.terminated.signal) {
            reason = 'Init Signal: ' + initContainerState.terminated.signal
          } else {
            reason = 'Init Exit Code: ' + initContainerState.terminated.exitCode
          }
        } else {
          reason = 'Init ' + initContainerState.terminated.reason
        }
        initializing = true
        break
      }

      if (
        initContainerState.waiting &&
        initContainerState.waiting.reason &&
        initContainerState.waiting.reason !== 'PodInitializing'
      ) {
        reason = 'Init ' + initContainerState.waiting.reason
        initializing = true
      }
    }

    if (!initializing) {
      reason = pod.status?.reason || pod.status?.phase || ''

      const containerStatuses = pod.status?.containerStatuses || []
      for (const containerStatus of containerStatuses) {
        const containerReason = containerStatus.state?.waiting?.reason || containerStatus.state?.terminated?.reason

        if (containerReason) {
          reason = containerReason
          break
        }

        const signal = containerStatus.state?.terminated?.signal
        if (signal) {
          reason = `Signal: ${signal}`
          break
        }

        const exitCode = containerStatus.state?.terminated?.exitCode
        if (exitCode) {
          reason = `Exit Code: ${exitCode}`
          break
        }
      }
    }

    return reason || 'unknown'
  }
}

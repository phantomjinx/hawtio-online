import { k8Service, K8Actions, KubeProject, KubePodsByProject, KubePod } from '@hawtio/online-kubernetes-api'
import React, { useEffect, useState } from 'react'
import { Panel, PanelHeader, PanelMain, PanelMainBody, Tab, Tabs, TabTitleText, Title } from '@patternfly/react-core'
import { KubernetesProjects } from './KubernetesProjects'
import { KubernetesPods } from './KubernetesPods'

export const KubernetesClient: React.FunctionComponent = () => {
  const [projects, setProjects] = useState<KubeProject[]>([])
  const [podsByProject, setPodsByProject] = useState<KubePodsByProject>({})
  const [activeTabKey, setActiveTabKey] = React.useState<string | number>(0)

  useEffect(() => {
    k8Service.on(K8Actions.CHANGED, () => {
      const projects = k8Service.getProjects()
      setProjects([...projects]) // must use spread to ensure update

      const pods: KubePodsByProject = k8Service.getPods()
      setPodsByProject(pods) // must use spread to ensure update

      setActiveTabKey(projects.length > 0 ? 0 : 1)
    })
  }, [])

  const handleTabClick = (
    event: React.MouseEvent<unknown> | React.KeyboardEvent | MouseEvent,
    tabIndex: string | number,
  ) => {
    setActiveTabKey(tabIndex)
  }

  return (
    <Panel>
      <PanelHeader>
        <Title headingLevel='h1'>Kubernetes Client</Title>
      </PanelHeader>
      <PanelMain>
        <PanelMainBody>
          <Tabs activeKey={activeTabKey} onSelect={handleTabClick} isBox>
            {projects.length > 0 && (
              <Tab eventKey={0} title={<TabTitleText>Projects</TabTitleText>}>
                <KubernetesProjects projects={projects} />
              </Tab>
            )}
            <Tab eventKey={1} title={<TabTitleText>Pods</TabTitleText>}>
              <KubernetesPods podsByProject={podsByProject} />
            </Tab>
          </Tabs>
        </PanelMainBody>
      </PanelMain>
    </Panel>
  )
}

import { useState } from 'react'
import { KMetadataByProject, KubePodsByProject } from '@hawtio/online-kubernetes-api'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionToggle,
  Panel,
  PanelMain,
  PanelMainBody,
} from '@patternfly/react-core'
import { KubernetesPaginatedPods } from './KubernetesPaginatedPods'

type KubePodsProps = {
  metadataByProject: KMetadataByProject
  podsByProject: KubePodsByProject
}

export const KubernetesProjectPods: React.FunctionComponent<KubePodsProps> = (props: KubePodsProps) => {

  const [expanded, setExpanded] = useState('')

  const onToggle = (id: string) => {
    if (id === expanded) {
      setExpanded('')
    } else {
      setExpanded(id)
    }
  }

  return (
    <Panel isScrollable>
      <PanelMain>
        <PanelMainBody>
          <Accordion asDefinitionList>
            {
              Object.entries(props.podsByProject).map(([project, pods]) => (
                <AccordionItem key={project}>
                  <AccordionToggle onClick={() => { onToggle(`project-${project}-toggle`) }}
                    isExpanded={expanded === `project-${project}-toggle`}
                    id={`project-${project}-toggle`}
                  >
                    {project}
                  </AccordionToggle>
                  <AccordionContent id={`project-${project}-expand`} isHidden={expanded !== `project-${project}-toggle`}>
                    <KubernetesPaginatedPods key={project} project={project} metadata={props.metadataByProject[project]} pods={pods} />
                  </AccordionContent>
                </AccordionItem>
              ))
            }
            </Accordion>
        </PanelMainBody>
      </PanelMain>
    </Panel>
  )
}

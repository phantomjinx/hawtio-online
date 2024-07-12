import React, { useState } from 'react'
import {
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Pagination,
  PerPageOptions,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core'
import { TableComposable, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { KubePod, PagingMetadata, k8Service } from '@hawtio/online-kubernetes-api'

type KubePagePodsProps = {
  project: string
  metadata: PagingMetadata
  pods: KubePod[]
}

export const KubernetesPaginatedPods: React.FunctionComponent<KubePagePodsProps> = (props: KubePagePodsProps) => {

  const prevPods = () => {
    // Should refresh from 2 components up
    k8Service.findPrevPods(props.project)
  }

  const nextPods = () => {
    // Should refresh from 2 components up
    k8Service.findNextPods(props.project)
  }

  return (
    <React.Fragment>
      <Toolbar id='pagination-toolbar-items' className='paginated-pods-toolbar-content'>
        <ToolbarContent>
          <ToolbarItem>
            <Button variant='control' onClick={() => prevPods()}
              isDisabled={props.metadata.previousRemaining() === 0}
              countOptions={{isRead: false, count: props.metadata.previousRemaining()}}
            >
              &lt;&lt; Previous
            </Button>
          </ToolbarItem>
          <ToolbarItem>
            <Button variant='control' onClick={() => nextPods()}
              isDisabled={props.metadata.currentRemaining() === 0}
              countOptions={{isRead: false, count: props.metadata.currentRemaining()}}
            >
              Next &gt;&gt;
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>

      <TableComposable key={props.project} aria-label='Pods table' variant='compact'>
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Namespace</Th>
            <Th>Labels</Th>
            <Th>Annotations</Th>
            <Th>Status</Th>
          </Tr>
        </Thead>
        <Tbody>
          {props.pods.map(pod => (
            <Tr key={pod.metadata?.uid}>
              <Td dataLabel='Name'>{pod.metadata?.name}</Td>
              <Td dataLabel='Namespace'>{pod.metadata?.namespace}</Td>
              <Td dataLabel='Labels'>
                <DescriptionList>
                  {Object.entries(pod.metadata?.labels || {}).map(([key, value]) => {
                    return (
                      <DescriptionListGroup key={key}>
                        <DescriptionListTerm>{key}</DescriptionListTerm>
                        <DescriptionListDescription>{value as string}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )
                  })}
                </DescriptionList>
              </Td>
              <Td dataLabel='Annotations'>
                <DescriptionList>
                  {Object.entries(pod.metadata?.annotations || {}).map(([key, value]) => {
                    return (
                      <DescriptionListGroup key={key}>
                        <DescriptionListTerm>{key}</DescriptionListTerm>
                        <DescriptionListDescription>{value as string}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )
                  })}
                </DescriptionList>
              </Td>
              <Td dataLabel='Status'>{k8Service.podStatus(pod)}</Td>
            </Tr>
          ))}
        </Tbody>
      </TableComposable>
    </React.Fragment>
  )
}

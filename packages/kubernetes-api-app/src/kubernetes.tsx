import { k8ApiInitialised, k8Api } from '@hawtio/online-kubernetes-api'
import React, { useRef, useEffect, useState } from 'react'
import {
  Alert,
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Divider,
  Panel,
  PanelHeader,
  PanelMain,
  PanelMainBody,
  Skeleton,
  Title } from '@patternfly/react-core'

export const Kubernetes: React.FunctionComponent = () => {
  const [isLoading, setIsLoading] = useState(true)
  const timeout = useRef<number>()

  useEffect(() => {
    setIsLoading(true)

    const checkLoading = async () => {
      if (! k8ApiInitialised())
        return

      setIsLoading(false)
    }

    checkLoading()

    timeout.current = window.setTimeout(checkLoading, 1000)

    return () => {
      window.clearTimeout(timeout.current)
    }

  }, [k8ApiInitialised])

  const kApiError = (): string => {
    if (!k8Api.hasError())
      return ''

    const error = k8Api.getError() as Error
    return error.message
  }

  if (isLoading) {
    return (
      <Card>
        <CardTitle>Kubernetes API</CardTitle>
        <CardBody>
          <Skeleton screenreaderText='Loading...' />
        </CardBody>
      </Card>
    )
  }

  if (k8Api.hasError()) {
    return (
      <Card>
        <CardTitle>Kubernetes API</CardTitle>
        <CardBody>
          <Alert variant="danger" title={kApiError()} />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardTitle><Title headingLevel="h1">Kubernetes API</Title></CardTitle>
      <CardBody>
        <Panel>
          <PanelHeader>API Properties</PanelHeader>
          <Divider />
          <PanelMain>
            <PanelMainBody>
              <DescriptionList isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>Kubernetes Master</DescriptionListTerm>
                  <DescriptionListDescription>{k8Api.getMasterUri()}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Is Openshift?</DescriptionListTerm>
                  <DescriptionListDescription>{k8Api.isOpenshift() ? 'true' : 'false'}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Kubernetes Config</DescriptionListTerm>
                  <DescriptionListDescription><pre>{JSON.stringify(k8Api.getOAuthProfile(), null, 2)}</pre></DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </PanelMainBody>
          </PanelMain>
        </Panel>
      </CardBody>
    </Card>
  )
}
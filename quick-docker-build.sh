#!/bin/bash

pull_build_image() {
  local CONTAINER_IMAGE="${1:-}"
  local CONTAINER_VERSION="${2:-}"
  local CONTAINER_MAKE="${3:-}"

  docker pull ${CONTAINER_IMAGE}:${CONTAINER_VERSION}
  if [ "$?" == "0" ]; then
    echo "Skipping build because tag ${CONTAINER_VERSION} already exists"
  else
    make ${CONTAINER_MAKE}
    if [ "$?" != "0" ]; then
      echo "Error: make ${CONTAINER_MAKE} failed"
      exit 1
    fi

    docker push ${CONTAINER_IMAGE}:${CONTAINER_VERSION}
    if [ "$?" != "0" ]; then
      echo "Error: docker push failed"
      exit 1
    fi
  fi
}


CLUSTER_TYPE=openshift
MODE=cluster
NAMESPACE=hawtio-dev

export CUSTOM_GATEWAY_IMAGE=quay.io/phantomjinx/hawtio-online-gateway
export CUSTOM_IMAGE=quay.io/phantomjinx/hawtio-online
MY_DATE="$(date -u '+%Y%m%d%H%M')"

while getopts ":v:s" opt; do
  case ${opt} in
    s)
      ONLY_BUILD=1
      ;;
    v)
      CUSTOM_VERSION=${OPTARG}
      ;;
    \?) echo "Usage: cmd [-s] [-v]"
      ;;
  esac
done

if [ -z "${CUSTOM_VERSION}" ]; then
  export CUSTOM_VERSION="2.1.0-${MY_DATE}"
fi

echo "Using custom version ${CUSTOM_VERSION}"

# Try pulling or building existing image
pull_build_image "${CUSTOM_IMAGE}" "${CUSTOM_VERSION}" "image"

# Try pulling or building existing gateway image
pull_build_image "${CUSTOM_GATEWAY_IMAGE}" "${CUSTOM_VERSION}" "image-gateway"

if [ "${ONLY_BUILD}" == "1" ]; then
  echo "Skipping install"
  exit 0
fi

pushd deploy || exit
OS_CONSOLE_URL=https://console-openshift-console.apps-crc.testing CLUSTER_TYPE=${CLUSTER_TYPE} MODE=${MODE} NAMESPACE=${NAMESPACE} CUSTOM_IMAGE=${CUSTOM_IMAGE} CUSTOM_VERSION=${CUSTOM_VERSION} make install
popd > /dev/null || exit

oc get pods -w

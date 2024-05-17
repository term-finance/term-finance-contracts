#!/bin/sh

HERE="$( cd "$( dirname "$0" )" >/dev/null 2>&1 && pwd )"
# Builds and runs the tests via Docker.

# set the build context to the parent directory
cd $HERE/../ && docker build -f tests/Dockerfile -t review-testing . && docker run -it review-testing
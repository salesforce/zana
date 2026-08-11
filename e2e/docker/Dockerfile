FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

ARG NODE_VERSION=22.23.2
ARG NODE_LINUX_X64_SHA256=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 xvfb build-essential libgtk-3-0t64 xz-utils zsh \
  && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  && echo "${NODE_LINUX_X64_SHA256}  node-v${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c - \
  && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
  && rm "node-v${NODE_VERSION}-linux-x64.tar.xz" \
  && rm -rf /var/lib/apt/lists/* \
  && node --version \
  && python3 --version

WORKDIR /workspace

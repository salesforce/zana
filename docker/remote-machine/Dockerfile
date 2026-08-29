# syntax=docker/dockerfile:1
# Playable Linux "remote machine" for Settings → Machines.
# Node 22, SSH on 22, sample workspace at /home/zcc/workspace.
# Enroll with `zcc-join` or JOIN_CODE/HOST_ID/ZCC_SERVER_URL at start.

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    findutils \
    git \
    openssh-server \
    passwd \
    util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/sshd \
  && ssh-keygen -A

# Official image already has uid 1000 (`node`); rename so SSH and bind mounts match.
RUN usermod -l zcc node \
  && groupmod -n zcc node \
  && usermod -m -d /home/zcc -s /bin/bash zcc \
  && mkdir -p /home/zcc/.ssh /home/zcc/workspace \
  && echo 'zcc:zcc' | chpasswd \
  && chown -R zcc:zcc /home/zcc \
  && chmod 700 /home/zcc/.ssh

COPY sshd_config /etc/ssh/sshd_config
COPY zcc-join /usr/local/bin/zcc-join
COPY entrypoint.sh /usr/local/bin/zcc-remote-entrypoint
COPY workspace/ /opt/zcc/sample-workspace/
RUN chmod 0755 /usr/local/bin/zcc-join /usr/local/bin/zcc-remote-entrypoint \
  && cp -a /opt/zcc/sample-workspace/. /home/zcc/workspace/ \
  && chown -R zcc:zcc /home/zcc/workspace

EXPOSE 22
WORKDIR /home/zcc/workspace
USER root
ENTRYPOINT ["/usr/local/bin/zcc-remote-entrypoint"]

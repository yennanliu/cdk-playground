# The throwaway container one agent job runs in.
#
# Built on the host at boot and referenced by /usr/local/bin/slack-agent-run-job.
# Phase 1 pushes this same image to ECR and runs it as a Fargate task, so keep
# it free of anything that assumes a host -- no volumes, no daemons, no state.
#
# Pulled from public ECR rather than Docker Hub: EC2 hits Hub's anonymous rate
# limit quickly, and a bootstrap that fails at 2am on a pull limit is a bad way
# to learn that.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

# The toolchain a coding job needs: fetch a repo, search it, build it, test it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       git \
       jq \
       python3 \
       ripgrep \
  && rm -rf /var/lib/apt/lists/*

# The runner bind-mounts a fresh scratch directory here and runs as uid 1000
# (the `node` user), which the image already provides.
WORKDIR /workspace
USER node

# Overridden per job; a bare shell is the useful default when you exec in to
# reproduce what a job did.
CMD ["bash"]

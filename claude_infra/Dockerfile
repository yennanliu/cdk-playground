# Use Ubuntu as base for better compatibility with code-server
FROM ubuntu:22.04

# Avoid interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    bash \
    sudo \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install code-server
ARG CODE_SERVER_VERSION=4.96.2
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --version=${CODE_SERVER_VERSION}

# Install Claude Code CLI
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Create a non-root user for development
RUN useradd -m -s /bin/bash -u 1001 developer && \
    echo "developer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set up workspace directory
RUN mkdir -p /workspace && \
    chown -R developer:developer /workspace

# Switch to non-root user
USER developer
WORKDIR /workspace

# Configure code-server
RUN mkdir -p /home/developer/.config/code-server && \
    echo "bind-addr: 0.0.0.0:8080" > /home/developer/.config/code-server/config.yaml && \
    echo "auth: password" >> /home/developer/.config/code-server/config.yaml && \
    echo "cert: false" >> /home/developer/.config/code-server/config.yaml

# Install useful VS Code extensions
RUN code-server --install-extension ms-python.python && \
    code-server --install-extension dbaeumer.vscode-eslint && \
    code-server --install-extension esbenp.prettier-vscode && \
    code-server --install-extension eamodio.gitlens

# Expose port for code-server
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

# Start code-server
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "/workspace"]

# ─────────────────────────────────────────────────────────────────────────────
# agentgateway + Hermes (+ npx/uvx MCP servers) in one image.
#
# WHY a custom image: agentgateway spawns each MCP `cmd` as a LOCAL child
# process. stdio is process-local — it cannot be reached over the network — so
# the Hermes binary (and any npx/uvx federated servers) MUST live in the same
# container as agentgateway. We therefore build a runtime that has Python + Node
# + uv + Hermes, then drop the agentgateway binary in beside them.
#
# ALTERNATIVE (no rebuild): keep the official agentgateway image and set the
# stdio cmd to `docker run --rm -i hermes-mcp-env`, mounting the docker socket.
# Cleaner isolation, but needs DinD/socket access and is fiddlier on macOS. The
# bundled image below is the most portable for the Mac mini.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: grab the agentgateway binary from the official image.
FROM ghcr.io/agentgateway/agentgateway:latest AS agw

# Stage 2: a runtime that can actually spawn the MCP child processes.
FROM python:3.12-slim AS runtime

# Node (for npx-based MCP servers) + uv/uvx (for Python MCP servers) + git.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates git nodejs npm \
    && pip install --no-cache-dir uv \
    && rm -rf /var/lib/apt/lists/*

# Pre-install the federated MCP servers so each per-connection stdio spawn is
# instant and quiet — no npx/uvx re-resolution (kills the PubGrub log spam and
# the ~7s first-spawn latency that would otherwise hit every new session).
RUN npm install -g @modelcontextprotocol/server-filesystem \
    && pip install --no-cache-dir mcp-server-fetch mcp-server-time

# Hermes (NousResearch/hermes-agent) — TODO, separate step. `pip install
# hermes-agent` pulls an UNRELATED PyPI package (runtime ModuleNotFoundError
# 'mcp_serve'). The real MCP server is mcp_serve.py and must be installed from
# source with its ~/.hermes config/credentials. Left out until that's wired:
#   RUN pip install --no-cache-dir git+https://github.com/NousResearch/hermes-agent.git

# Copy the agentgateway binary out of the official image.
# Confirmed path via `docker inspect ... .Config.Entrypoint` → ["/app/agentgateway"].
COPY --from=agw /app/agentgateway /usr/local/bin/agentgateway

# Unprivileged user with a stable HOME for Hermes' ~/.hermes session store.
RUN useradd --create-home --home-dir /home/hermes --shell /bin/bash hermes \
    && mkdir -p /home/hermes/.hermes /workspace \
    && chown -R hermes:hermes /home/hermes /workspace
USER hermes
ENV HOME=/home/hermes

EXPOSE 3000 15000
ENTRYPOINT ["agentgateway"]
CMD ["-f", "/etc/agentgateway/config.yaml"]

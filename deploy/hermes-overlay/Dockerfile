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

# Hermes agent (provides `hermes mcp serve`). Pin a version in production.
# If Hermes is installed from source rather than PyPI, replace this with the
# appropriate `pip install git+https://github.com/NousResearch/hermes-agent.git`.
RUN pip install --no-cache-dir hermes-agent || \
    echo ">> Adjust the Hermes install line to match your distribution."

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

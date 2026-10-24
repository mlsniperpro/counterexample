# Counterexample sandbox: Judge0-compatible runner for Python 3 and Node.js.
# Build:  docker build -t counterexample-sandbox sandbox/
# Run:    docker run --rm -p 2358:2358 -e SANDBOX_TOKEN=change-me --read-only --tmpfs /tmp counterexample-sandbox
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs /app/server.mjs
# The server runs as root only to start each submission as its run slot's own
# unprivileged uid (20000 + slot) and to kill every process of that uid after
# the run; submitted code never runs as root. See the header of server.mjs.
ENV PORT=2358 NODE_ENV=production
EXPOSE 2358
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:2358/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tini as PID 1 reaps the processes each run leaves behind once they are killed.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server.mjs"]

# Counterexample sandbox: Judge0-compatible runner for Python 3 and Node.js.
# Build:  docker build -t counterexample-sandbox sandbox/
# Run:    docker run --rm -p 2358:2358 -e SANDBOX_TOKEN=change-me --read-only --tmpfs /tmp counterexample-sandbox
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 sandbox
WORKDIR /app
COPY server.mjs /app/server.mjs
USER sandbox
ENV PORT=2358 NODE_ENV=production
EXPOSE 2358
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:2358/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/server.mjs"]

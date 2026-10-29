# Counterexample sandbox: Judge0-compatible runner for Python 3 and Node.js.
# Build:  docker build -t counterexample-sandbox sandbox/
# Run:    docker run --rm -p 2358:2358 -e SANDBOX_TOKEN=change-me --read-only --tmpfs /tmp:size=64m \
#           --tmpfs /dev/shm:size=1m --memory 2g --pids-limit 512 --cap-drop ALL \
#           --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID --cap-add KILL \
#           --security-opt no-new-privileges counterexample-sandbox
# Submitted code has no network either way: a seccomp filter denies it socket() (see server.mjs).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 tini \
 && rm -rf /var/lib/apt/lists/* \
 && find / -xdev ! -type l -perm -0002 -exec chmod o-w {} + \
 && chmod 0711 /tmp /var/tmp
WORKDIR /app
COPY server.mjs /app/server.mjs
# The server runs as root only to start each submission as its run slot's own
# unprivileged uid (20000 + slot) and to kill every process of that uid after
# the run; submitted code never runs as root. No directory in the image is
# writable by run uids (the find above), and at start the server locks /tmp
# and /dev/shm too, in case the platform mounts fresh ones. See the header of
# server.mjs. CX_SANDBOX_IMAGE=1 also makes SANDBOX_TOKEN mandatory.
ENV PORT=2358 NODE_ENV=production CX_SANDBOX_IMAGE=1
EXPOSE 2358
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:2358/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tini as PID 1 reaps the processes each run leaves behind once they are killed.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server.mjs"]

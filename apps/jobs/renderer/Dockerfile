FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node render.mjs server.mjs ./
USER node
ENV PORT=8790 RENDER_HOST=0.0.0.0
EXPOSE 8790
CMD ["node", "server.mjs"]

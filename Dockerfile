FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY scripts ./scripts

ENV MCP_TRANSPORT=http
ENV MCP_HOST=0.0.0.0

EXPOSE 3017

CMD ["node", "src/index.js"]

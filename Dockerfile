FROM node:20-alpine

WORKDIR /app

COPY server.js ./
COPY index.html ./
COPY landing.html ./
COPY dvrtv.wgt ./
COPY icon.png ./
COPY manifest.json ./
COPY config.xml ./
COPY css/ ./css/
COPY js/ ./js/
COPY mobile/ ./mobile/
COPY images/ ./images/

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]

FROM nodered/node-red:4.0.9
USER root
COPY package*.json /opt/health-dashboard/
RUN cd /opt/health-dashboard && npm ci --omit=dev --no-audit --no-fund
USER node-red

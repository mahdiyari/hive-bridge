FROM node:lts-slim

# Enable IPv6-only APT behavior when requested (keeps IPv4-only builds working).
ARG FORCE_IPV6=false
RUN if [ "$FORCE_IPV6" = "true" ]; then \
        echo 'Acquire::ForceIPv6 "true";' > /etc/apt/apt.conf.d/99force-ipv6; \
    fi \
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && if [ "$FORCE_IPV6" = "true" ]; then rm -f /etc/apt/apt.conf.d/99force-ipv6; fi

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3018

LABEL git_repository="https://github.com/mahdiyari/hive-bridge"

CMD ["node", "--import", "tsx", "src/core/index.ts"]

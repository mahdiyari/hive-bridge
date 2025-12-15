FROM node:lts-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y openssl && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3018

LABEL git_repository="https://github.com/mahdiyari/hive-bridge"

CMD ["npm", "run", "start"]

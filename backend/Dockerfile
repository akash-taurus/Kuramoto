FROM node:18-alpine

WORKDIR /app

# Enable caching of dependencies
COPY package*.json ./
RUN npm ci

COPY . .

# Run as non-root user for security best practice
USER node

EXPOSE 8080

CMD ["node", "server.js"]

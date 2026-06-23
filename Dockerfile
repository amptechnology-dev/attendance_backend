FROM node:20-alpine
WORKDIR /usr/src/app

# Copy dependencies
COPY package.json package-lock.json ./
RUN npm install --production

# Copy app code
COPY . .

# Production environment
ENV NODE_ENV=production

# Expose app port
EXPOSE 8001

# Start app
CMD ["node", "./src/index.js"]
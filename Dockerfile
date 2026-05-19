FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package.json .

RUN npm install

RUN npx playwright install chromium

COPY . .
RUN mkdir -p /app/logs

CMD ["node", "src/index.js"]
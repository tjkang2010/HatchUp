# Node.js 20 기반 배포 이미지
FROM node:20-alpine

WORKDIR /app

# 의존성 설치
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# 소스 코드 복사
COPY . .

# 포트 노출
EXPOSE 3000

# 헬스 체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

# 서버 시작
CMD ["npm", "start"]

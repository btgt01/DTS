# 部署指南

## 方案一：Railway 部署（推荐，最简单）

Railway 是一个免费的 Node.js 应用托管平台，5分钟可完成部署。

### 步骤：

1. **准备代码**
   - 将整个 `digital-transform-system` 文件夹压缩为 zip
   - 或上传到 GitHub 仓库

2. **注册 Railway**
   - 访问 https://railway.app
   - 用 GitHub 账号登录

3. **创建项目**
   - 点击 "New Project" → "Deploy from GitHub repo"
   - 选择刚才的仓库，或直接上传代码

4. **配置启动命令**
   - Railway 会自动识别 Node.js
   - 启动命令设为：`node server.js`
   - 环境变量：`PORT = 3000`

5. **部署完成**
   - Railway 会分配一个免费域名（如 `your-app.railway.app`）
   - 访问该域名即可使用！

### Railway 特点
- ✅ 免费额度：每月 $5 / 500小时
- ✅ 自动 HTTPS
- ✅ 持久化 SQLite 数据库（保存在 Railway 存储中）
- ✅ 无需服务器运维

---

## 方案二：腾讯云 CVM 云服务器

如果你有腾讯云 CVM：

1. **上传代码到服务器**
   ```bash
   scp -r digital-transform-system root@你的服务器IP:/opt/
   ```

2. **在服务器上安装 Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs
   ```

3. **安装依赖**
   ```bash
   cd /opt/digital-transform-system
   npm install
   ```

4. **使用 PM2 运行**
   ```bash
   npm install -g pm2
   pm2 start server.js --name dts
   pm2 save
   pm2 startup
   ```

5. **配置 Nginx 反向代理**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       location / {
           proxy_pass http://127.0.0.1:8899;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
       }
   }
   ```

6. **配置域名和 SSL**
   - 在腾讯云控制台绑定域名
   - 申请免费 SSL 证书
   - 开启 HTTPS

---

## 方案三：腾讯云 CloudBase 部署

### 前提条件
- 腾讯云账号（https://cloud.tencent.com）
- 开通云开发 CloudBase

### 部署步骤

1. **安装 CloudBase CLI**
   ```bash
   npm install -g @cloudbase/cli
   ```

2. **登录**
   ```bash
   tcb login
   ```

3. **初始化项目**
   ```bash
   cd digital-transform-system
   tcb init
   # 选择环境，或创建新环境
   ```

4. **修改 cloudbase-server.js**
   - 确保 `@cloudbase/node-sdk` 依赖在 package.json 中

5. **部署云函数**
   ```bash
   tcb fn deploy server
   ```

6. **部署静态文件**
   ```bash
   tcb hosting deploy ./
   ```

7. **访问**
   - CloudBase 会提供访问地址

---

## 超级管理员信息

- **用户名：** admin
- **密码：** DTS@Admin2026
- **管理员邮箱：** 282727653@qq.com

> ⚠️ 首次部署后请立即登录并修改管理员密码！

## 注意事项

1. 新用户注册后需要管理员审批才能登录
2. 数据库文件（users.db）会保存在服务器本地
3. 如果部署到 Heroku/Render 等平台，需要注意 SQLite 数据持久化（建议改用云数据库）
4. 建议使用 PM2 管理进程，确保服务器重启后自动启动

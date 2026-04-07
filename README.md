# 企业数字化转型规划系统 🚀

> 企业级数字化转型全流程规划工具，支持调研诊断、总体规划、实施路径三大板块，含注册审批系统。

## 功能特性

- 🔐 **用户系统**：注册需审批、角色管理、审计日志
- 📊 **调研诊断**：数字化/数据管理/智能制造成熟度评估、访谈分析、对标研究
- 📐 **总体规划**：TOGAF方法论，业务/数据/应用/技术/安全/治理架构
- 🛤️ **实施路径**：项目优先级、五年路线图、投资估算
- 📄 **报告导出**：Word / PPT / Excel 格式
- ⚙️ **管理后台**：用户审批、数据统计、操作日志

## 超级管理员

- 用户名：`admin`
- 密码：`DTS@Admin2026`
- 邮箱：`282727653@qq.com`

> ⚠️ 首次登录后请立即修改密码！

## 本地运行

```bash
npm install
npm start
# 访问 http://localhost:8899
```

## 一键部署到互联网（Railway，推荐）

Railway 提供免费 Node.js 托管，5分钟完成部署：

### 第一步：上传到 GitHub

1. 在 GitHub 创建新仓库（如 `digital-transform-system`）
2. 将本文件夹所有内容上传到仓库

### 第二步：连接 Railway

1. 访问 https://railway.app 并用 GitHub 登录
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择刚才创建的仓库
4. Railway 会自动检测为 Node.js 应用
5. 等待自动部署完成（约2-3分钟）

### 第三步：完成！

Railway 会生成一个免费域名（如 `blue-water-xxxx.railway.app`），点击即可访问！

- ✅ 免费 HTTPS
- ✅ 自动构建
- ✅ 持久化数据库
- ✅ 永不宕机

## 部署到腾讯云 CVM

```bash
# 1. 上传代码
scp -r . root@你的服务器IP:/opt/dts

# 2. 服务器安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. 安装依赖并启动
cd /opt/dts
npm install
pm2 start server.js --name dts
pm2 save && pm2 startup
```

## 技术栈

- 前端：HTML5 + CSS3 + Vanilla JS（响应式单页应用）
- 后端：Node.js + Express
- 数据库：SQL.js（SQLite，纯JS实现）
- 认证：bcrypt + Session/Cookie
- 部署：支持任何 Node.js 托管平台

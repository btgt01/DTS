# 腾讯云 CloudBase 部署指南

腾讯云 CloudBase（云开发）免费额度充足，国内访问速度快，适合部署本系统。

---

## 一、准备工作

### 1. 注册腾讯云账号
- 访问 https://cloud.tencent.com 注册账号
- 建议用微信扫码登录

### 2. 开通云开发 CloudBase
- 登录后进入控制台
- 搜索"云开发"或"CloudBase"
- 点击"免费开通"

---

## 二、安装 CloudBase CLI

### Windows PowerShell（管理员）
```powershell
npm install -g @cloudbase/cli
```

或下载安装：
- Windows: https://github.com/TencentCloudBase/cloudbase-cli/releases

### 验证安装
```powershell
tcb -v
```

---

## 三、部署步骤

### 1. 登录腾讯云
```powershell
tcb login
```
浏览器会弹出授权，确认即可。

### 2. 创建云开发环境
```powershell
tcb env:create
```
- 环境名称：如 `dts-prod`
- 选择地域：广州/上海/北京（就近选择）
- 计费方式：按量付费（免费额度足够）

### 3. 获取环境 ID
```powershell
tcb env:list
```
记录显示的环境 ID，如 `env-xxxxx`

### 4. 修改配置文件
在项目根目录的 `cloudbaserc.json` 中，把 `{{envId}}` 替换为你的环境 ID：

```json
{
  "envId": "env-xxxxx",  // 替换这里
  "version": "2.0",
  ...
}
```

### 5. 安装项目依赖
```powershell
cd digital-transform-system
npm install
```

### 6. 初始化数据库集合
在腾讯云控制台手动创建集合：

1. 进入 CloudBase 控制台 → 数据库
2. 创建以下集合：
   - `dts_users`（用户表）
   - `dts_sessions`（会话表）
   - `dts_audit`（审计日志表）

**权限配置**（重要）：
- `dts_users`: 所有用户可读，管理员可写
- `dts_sessions`: 仅创建者可读写
- `dts_audit`: 仅管理员可读写

### 7. 创建超级管理员
方式A - 运行初始化脚本：
```powershell
set TCB_ENV_ID=env-xxxxx
node init-admin.js
```

方式B - 手动在数据库中添加：
```json
{
  "id": "admin001",
  "username": "admin",
  "password": "h_xxxxx",  // 密码 DTS@Admin2026 的 hash
  "email": "282727653@qq.com",
  "company": "系统管理",
  "role": "admin",
  "status": "approved",
  "created_at": "2026-04-06T00:00:00.000Z"
}
```

### 8. 部署静态文件
```powershell
tcb hosting deploy ./
```
上传所有文件到云存储。

### 9. 部署云函数
```powershell
tcb fn deploy server
```

### 10. 配置静态网站托管
1. CloudBase 控制台 → 静态网站托管
2. 开启托管
3. 设置默认路由：`index.html`
4. 配置404回退：`index.html`

---

## 四、访问网站

部署完成后，CloudBase 会提供访问地址，如：
- https://env-xxxxx-xxxxxxxx.cloudbasecn.cn

或在"静态网站托管"中查看分配的域名。

---

## 五、超级管理员账号

- **用户名：** `admin`
- **密码：** `DTS@Admin2026`
- **邮箱：** `282727653@qq.com`

> ⚠️ **首次登录后请立即修改密码！**

---

## 六、常见问题

### Q1: 云函数部署失败
检查 `@cloudbase/node-sdk` 版本：
```powershell
npm install @cloudbase/node-sdk@latest
```

### Q2: 数据库集合不存在
确保已在控制台创建 `dts_users`、`dts_sessions`、`dts_audit` 三个集合。

### Q3: 跨域问题
CloudBase 云函数默认已配置 CORS，如仍有问题检查：
- 云函数控制台 → 函数配置 → 响应配置

### Q4: 免费额度说明
- 静态网站托管：免费
- 云函数：每月 40万 GB-秒
- 数据库：每日 5万次读写
- 云存储：每月 5GB

个人/小团队使用完全足够。

---

## 七、更新部署

代码更新后，重新执行：
```powershell
tcb hosting deploy ./
tcb fn deploy server
```

---

## 八、绑定自定义域名（可选）

1. 准备域名（已在工信部备案）
2. CloudBase 控制台 → 静态网站托管 → 添加域名
3. 添加 DNS 解析 CNAME 记录

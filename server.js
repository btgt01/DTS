const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8899;

// PostgreSQL 连接池
// Railway 会自动注入 DATABASE_URL 环境变量
// 本地开发时可用 DATABASE_URL 或单独的 PG* 环境变量
function buildPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'dts',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    ssl: { rejectUnauthorized: false }
  };
}

const pool = new Pool(buildPgConfig());

// ===== 数据库辅助函数（pg 返回 Promise）=====
async function dbGet(sql, params = []) {
  const res = await pool.query(sql, params);
  if (!res.rows.length) return null;
  const obj = {};
  const cols = res.fields.map(f => f.name);
  cols.forEach((c, i) => obj[c] = res.rows[0][c]);
  return obj;
}

async function dbAll(sql, params = []) {
  const res = await pool.query(sql, params);
  if (!res.rows.length) return [];
  const cols = res.fields.map(f => f.name);
  return res.rows.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[c]);
    return obj;
  });
}

async function dbRun(sql, params = []) {
  await pool.query(sql, params);
}

// ===== 初始化数据库表 =====
async function initDB() {
  // 创建 users 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT DEFAULT '',
      company TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      approved_at TIMESTAMP,
      approved_by TEXT
    )
  `);

  // 创建 sessions 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `);

  // 创建 audit_logs 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 创建 tool_data 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tool_data (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      module_name TEXT DEFAULT '',
      data TEXT DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, module_id)
    )
  `);

  // 创建超级管理员（如果不存在）
  const admin = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admin.rows.length === 0) {
    const adminId = uuidv4();
    const hash = bcrypt.hashSync('DTS@Admin2026', 10);
    await pool.query(
      "INSERT INTO users (id, username, password, email, role, status, approved_at, approved_by) VALUES ($1, $2, $3, $4, 'admin', 'approved', NOW(), 'system')",
      [adminId, 'admin', hash, '282727653@qq.com']
    );
    console.log('✅ 超级管理员已创建: admin / DTS@Admin2026');
  }

  console.log('✅ PostgreSQL 数据库初始化完成');
}

async function logAudit(action, userId, detail) {
  try {
    await dbRun(
      "INSERT INTO audit_logs (id, action, user_id, detail, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [uuidv4(), action, userId || '', detail]
    );
  } catch (e) {}
}

// ===== 中间件 =====
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dts-secret-2026-digital-transform',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// 静态文件
app.use(express.static(__dirname));

// API路由
const api = express.Router();
app.use('/api', api);

// ===== 注册 =====
api.post('/register', async (req, res) => {
  const { username, password, email, company } = req.body;
  if (!username || !password) return res.json({ success: false, message: '用户名和密码不能为空' });
  if (password.length < 6) return res.json({ success: false, message: '密码至少6位' });
  const existing = await dbGet("SELECT id FROM users WHERE username = $1", [username]);
  if (existing) return res.json({ success: false, message: '用户名已存在' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  await dbRun(
    "INSERT INTO users (id, username, password, email, company, status) VALUES ($1, $2, $3, $4, $5, 'pending')",
    [id, username, hash, email || '', company || '']
  );
  logAudit('REGISTER', null, `新用户注册: ${username} (${email || '无邮箱'})`);
  res.json({ success: true, message: '注册成功！请等待管理员审批后登录。' });
});

// ===== 登录 =====
api.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: '请输入用户名和密码' });
  const user = await dbGet("SELECT * FROM users WHERE username = $1", [username]);
  if (!user) return res.json({ success: false, message: '用户名或密码错误' });
  if (user.status === 'pending') return res.json({ success: false, message: '账号正在等待审批，请联系管理员。' });
  if (user.status === 'rejected') return res.json({ success: false, message: '账号审批未通过，请联系管理员。' });
  if (!bcrypt.compareSync(password, user.password)) return res.json({ success: false, message: '用户名或密码错误' });
  const sid = uuidv4();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await dbRun(
    "INSERT INTO sessions (sid, user_id, expires_at) VALUES ($1, $2, $3)",
    [sid, user.id, expires]
  );
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.cookie('dts_sid', sid, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  logAudit('LOGIN', user.id, '登录成功');
  res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, company: user.company, role: user.role } });
});

// ===== 登出 =====
api.post('/logout', async (req, res) => {
  const sid = req.cookies.dts_sid;
  if (sid) await dbRun("DELETE FROM sessions WHERE sid = $1", [sid]);
  req.session.destroy();
  res.clearCookie('dts_sid');
  res.json({ success: true });
});

// ===== 验证登录 =====
api.get('/check', async (req, res) => {
  const sid = req.cookies.dts_sid;
  if (!sid) return res.json({ loggedIn: false });
  const session = await dbGet("SELECT * FROM sessions WHERE sid = $1 AND expires_at > NOW()", [sid]);
  if (!session) return res.json({ loggedIn: false });
  const user = await dbGet(
    "SELECT id, username, email, company, role, status FROM users WHERE id = $1 AND status = 'approved'",
    [session.user_id]
  );
  if (!user) return res.json({ loggedIn: false });
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ loggedIn: true, user });
});

// ===== 辅助：验证管理员 =====
function requireAdmin(req, res) {
  if (!req.session.role || req.session.role !== 'admin') {
    res.json({ success: false, message: '需要管理员权限' });
    return false;
  }
  return true;
}

// ===== 辅助：验证登录 =====
function requireAuth(req, res) {
  if (!req.session.userId) {
    res.json({ success: false, message: '请先登录' });
    return false;
  }
  return true;
}

// ===== 待审批用户 =====
api.get('/admin/pending-users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = await dbAll("SELECT id, username, email, company, created_at FROM users WHERE status = 'pending' ORDER BY created_at DESC");
  res.json({ success: true, users });
});

// ===== 所有用户 =====
api.get('/admin/all-users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = await dbAll("SELECT id, username, email, company, role, status, created_at, approved_at FROM users ORDER BY created_at DESC");
  res.json({ success: true, users });
});

// ===== 统计数据 =====
api.get('/admin/stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const total = await dbGet("SELECT COUNT(*) as c FROM users");
  const pending = await dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'pending'");
  const approved = await dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'approved'");
  const rejected = await dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'rejected'");
  res.json({ success: true, stats: { total: parseInt(total?.c) || 0, pending: parseInt(pending?.c) || 0, approved: parseInt(approved?.c) || 0, rejected: parseInt(rejected?.c) || 0 } });
});

// ===== 审批用户 =====
api.post('/admin/approve-user', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, action } = req.body;
  if (!userId || !action) return res.json({ success: false, message: '参数错误' });
  const user = await dbGet("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  if (user.status !== 'pending') return res.json({ success: false, message: '用户状态不是待审批' });
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await dbRun("UPDATE users SET status = $1, approved_at = NOW(), approved_by = $2 WHERE id = $3", [newStatus, req.session.username, userId]);
  logAudit(action === 'approve' ? 'APPROVE' : 'REJECT', req.session.userId, `${req.session.username} ${action === 'approve' ? '批准' : '拒绝'}用户 ${user.username}`);
  res.json({ success: true, message: action === 'approve' ? '已批准' : '已拒绝' });
});

// ===== 删除用户 =====
api.post('/admin/delete-user', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.body;
  const user = await dbGet("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  if (user.role === 'admin') return res.json({ success: false, message: '不能删除管理员账号' });
  await dbRun("DELETE FROM users WHERE id = $1", [userId]);
  logAudit('DELETE', req.session.userId, `删除用户: ${user.username}`);
  res.json({ success: true });
});

// ===== 修改用户密码 =====
api.post('/admin/reset-password', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.json({ success: false, message: '密码长度不能少于6位' });
  }
  const user = await dbGet("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await dbRun("UPDATE users SET password = $1 WHERE id = $2", [hashed, userId]);
  logAudit('RESET_PWD', req.session.userId, `重置用户 ${user.username} 的密码`);
  res.json({ success: true, message: '密码已重置' });
});

// ===== 审计日志 =====
api.get('/admin/audit-logs', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const logs = await dbAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
  res.json({ success: true, logs });
});

// ===== 保存工具数据 =====
api.post('/data/save', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { moduleId, moduleName, data } = req.body;
  if (!moduleId) return res.json({ success: false, message: '模块ID不能为空' });
  try {
    const existing = await dbGet("SELECT id FROM tool_data WHERE user_id = $1 AND module_id = $2", [req.session.userId, moduleId]);
    if (existing) {
      await dbRun(
        "UPDATE tool_data SET module_name = $1, data = $2, updated_at = NOW() WHERE user_id = $3 AND module_id = $4",
        [moduleName || moduleId, JSON.stringify(data), req.session.userId, moduleId]
      );
    } else {
      await dbRun(
        "INSERT INTO tool_data (id, user_id, module_id, module_name, data) VALUES ($1, $2, $3, $4, $5)",
        [uuidv4(), req.session.userId, moduleId, moduleName || moduleId, JSON.stringify(data)]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: '保存失败: ' + e.message });
  }
});

// ===== 加载工具数据 =====
api.get('/data/load/:moduleId', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { moduleId } = req.params;
  const row = await dbGet("SELECT * FROM tool_data WHERE user_id = $1 AND module_id = $2", [req.session.userId, moduleId]);
  if (!row) return res.json({ success: true, data: null });
  try {
    res.json({ success: true, data: JSON.parse(row.data), updated_at: row.updated_at });
  } catch (e) {
    res.json({ success: true, data: null });
  }
});

// ===== 加载当前用户所有工具进度 =====
api.get('/data/progress', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rows = await dbAll("SELECT module_id, module_name, updated_at FROM tool_data WHERE user_id = $1 ORDER BY updated_at DESC", [req.session.userId]);
  res.json({ success: true, modules: rows });
});

// ===== 管理员：全局数据统计 =====
api.get('/admin/data-stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const moduleUsage = await dbAll(`
    SELECT module_id, module_name, COUNT(*) as count,
           COUNT(DISTINCT user_id) as user_count,
           MAX(updated_at) as last_update
    FROM tool_data GROUP BY module_id ORDER BY count DESC
  `);
  const activeUsers = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM tool_data");
  const recentActive = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM tool_data WHERE updated_at > NOW() - INTERVAL '7 days'");
  const totalRecords = await dbGet("SELECT COUNT(*) as c FROM tool_data");
  res.json({
    success: true,
    stats: {
      totalRecords: parseInt(totalRecords?.c) || 0,
      activeUsers: parseInt(activeUsers?.c) || 0,
      recentActive: parseInt(recentActive?.c) || 0,
      moduleUsage
    }
  });
});

// ===== 管理员：查看所有用户数据摘要 =====
api.get('/admin/users-data', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = await dbAll(`
    SELECT u.id, u.username, u.email, u.company, u.status, u.created_at,
           COUNT(td.id) as module_count,
           MAX(td.updated_at) as last_activity
    FROM users u
    LEFT JOIN tool_data td ON u.id = td.user_id
    WHERE u.role != 'admin'
    GROUP BY u.id
    ORDER BY last_activity DESC NULLS LAST
  `);
  res.json({ success: true, users });
});

// ===== 管理员：查看指定用户所有数据 =====
api.get('/admin/user-data/:userId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.params;
  const user = await dbGet("SELECT id, username, email, company, status, created_at FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const rows = await dbAll("SELECT module_id, module_name, updated_at FROM tool_data WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
  res.json({ success: true, user, modules: rows });
});

// ===== 管理员：导出指定用户单模块数据 =====
api.get('/admin/export-user-module/:userId/:moduleId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, moduleId } = req.params;
  const row = await dbGet("SELECT * FROM tool_data WHERE user_id = $1 AND module_id = $2", [userId, moduleId]);
  if (!row) return res.json({ success: false, message: '无数据' });
  const user = await dbGet("SELECT username FROM users WHERE id = $1", [userId]);
  try {
    res.json({ success: true, data: JSON.parse(row.data), module_name: row.module_name, username: user?.username });
  } catch (e) {
    res.json({ success: false, message: '数据解析失败' });
  }
});

// ===== 管理员：导出用户全部数据（JSON下载）=====
api.get('/admin/export-user-all/:userId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.params;
  const user = await dbGet("SELECT username, email, company FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const rows = await dbAll("SELECT module_id, module_name, data, updated_at FROM tool_data WHERE user_id = $1 ORDER BY updated_at", [userId]);
  const exportData = { user, records: rows.map(r => ({ ...r, data: JSON.parse(r.data) })) };
  res.setHeader('Content-Disposition', `attachment; filename="${user.username}_数据导出.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

// ===== 管理员：删除指定用户所有数据 =====
api.post('/admin/delete-user-data', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, message: '参数错误' });
  const user = await dbGet("SELECT username FROM users WHERE id = $1", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  await dbRun("DELETE FROM tool_data WHERE user_id = $1", [userId]);
  logAudit('DEL_DATA', req.session.userId, `清除了用户 ${user.username} 的所有工具数据`);
  res.json({ success: true });
});

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// 启动
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 企业数字化转型规划系统`);
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`👤 管理员: admin / DTS@Admin2026`);
    console.log(`📋 注册需审批后方可登录`);
    console.log(`🗄️  数据库: PostgreSQL`);
  });
}).catch(e => { console.error('启动失败:', e); process.exit(1); });

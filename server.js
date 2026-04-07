const express = require('express');
const session = require('express-session');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8899;
const DB_PATH = path.join(__dirname, 'data', 'users.db');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db;
const SQL = {};

// 初始化数据库
async function initDB() {
  const SQLJS = await initSqlJs();
  // 加载已有数据库或创建新数据库
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQLJS.Database(buf);
  } else {
    db = new SQLJS.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT DEFAULT '',
      company TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT,
      approved_by TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_data (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      module_name TEXT DEFAULT '',
      data TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, module_id)
    )
  `);
  saveDB();
  // 创建超级管理员
  const admin = db.exec("SELECT id FROM users WHERE role = 'admin'");
  if (admin.length === 0 || admin[0].values.length === 0) {
    const adminId = uuidv4();
    const hash = bcrypt.hashSync('DTS@Admin2026', 10);
    db.run("INSERT INTO users (id, username, password, email, role, status, approved_at, approved_by) VALUES (?, ?, ?, ?, 'admin', 'approved', datetime('now'), 'system')",
      [adminId, 'admin', hash, '282727653@qq.com']);
    saveDB();
    console.log('✅ 超级管理员已创建: admin / DTS@Admin2026');
  }
  console.log('✅ 数据库初始化完成');
}

function saveDB() {
  try {
    const data = db.export();
    const buf = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buf);
  } catch(e) { console.error('DB save error:', e.message); }
}

function dbGet(sql, params = []) {
  const r = db.exec(sql, params);
  if (!r.length || !r[0].values.length) return null;
  const cols = r[0].columns;
  const vals = r[0].values[0];
  const obj = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return obj;
}

function dbAll(sql, params = []) {
  const r = db.exec(sql, params);
  if (!r.length) return [];
  const cols = r[0].columns;
  return r[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function logAudit(action, userId, detail) {
  try { dbRun("INSERT INTO audit_logs (id, action, user_id, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))", [uuidv4(), action, userId || '', detail]); } catch(e) {}
}

// 中间件
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
api.post('/register', (req, res) => {
  const { username, password, email, company } = req.body;
  if (!username || !password) return res.json({ success: false, message: '用户名和密码不能为空' });
  if (password.length < 6) return res.json({ success: false, message: '密码至少6位' });
  const existing = dbGet("SELECT id FROM users WHERE username = ?", [username]);
  if (existing) return res.json({ success: false, message: '用户名已存在' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  dbRun("INSERT INTO users (id, username, password, email, company, status) VALUES (?, ?, ?, ?, ?, 'pending')", [id, username, hash, email || '', company || '']);
  logAudit('REGISTER', null, `新用户注册: ${username} (${email || '无邮箱'})`);
  res.json({ success: true, message: '注册成功！请等待管理员审批后登录。' });
});

// ===== 登录 =====
api.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: '请输入用户名和密码' });
  const user = dbGet("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) return res.json({ success: false, message: '用户名或密码错误' });
  if (user.status === 'pending') return res.json({ success: false, message: '账号正在等待审批，请联系管理员。' });
  if (user.status === 'rejected') return res.json({ success: false, message: '账号审批未通过，请联系管理员。' });
  if (!bcrypt.compareSync(password, user.password)) return res.json({ success: false, message: '用户名或密码错误' });
  const sid = uuidv4();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  dbRun("INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, ?)", [sid, user.id, expires]);
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.cookie('dts_sid', sid, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  logAudit('LOGIN', user.id, '登录成功');
  res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, company: user.company, role: user.role } });
});

// ===== 登出 =====
api.post('/logout', (req, res) => {
  const sid = req.cookies.dts_sid;
  if (sid) { dbRun("DELETE FROM sessions WHERE sid = ?", [sid]); }
  req.session.destroy();
  res.clearCookie('dts_sid');
  res.json({ success: true });
});

// ===== 验证登录 =====
api.get('/check', (req, res) => {
  const sid = req.cookies.dts_sid;
  if (!sid) return res.json({ loggedIn: false });
  const session = dbGet("SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')", [sid]);
  if (!session) return res.json({ loggedIn: false });
  const user = dbGet("SELECT id, username, email, company, role, status FROM users WHERE id = ? AND status = 'approved'", [session.user_id]);
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

// ===== 待审批用户 =====
api.get('/admin/pending-users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = dbAll("SELECT id, username, email, company, created_at FROM users WHERE status = 'pending' ORDER BY created_at DESC");
  res.json({ success: true, users });
});

// ===== 所有用户 =====
api.get('/admin/all-users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = dbAll("SELECT id, username, email, company, role, status, created_at, approved_at FROM users ORDER BY created_at DESC");
  res.json({ success: true, users });
});

// ===== 统计数据 =====
api.get('/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const total = dbGet("SELECT COUNT(*) as c FROM users");
  const pending = dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'pending'");
  const approved = dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'approved'");
  const rejected = dbGet("SELECT COUNT(*) as c FROM users WHERE status = 'rejected'");
  res.json({ success: true, stats: { total: total?.c || 0, pending: pending?.c || 0, approved: approved?.c || 0, rejected: rejected?.c || 0 } });
});

// ===== 审批用户 =====
api.post('/admin/approve-user', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, action } = req.body;
  if (!userId || !action) return res.json({ success: false, message: '参数错误' });
  const user = dbGet("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  if (user.status !== 'pending') return res.json({ success: false, message: '用户状态不是待审批' });
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  dbRun("UPDATE users SET status = ?, approved_at = datetime('now'), approved_by = ? WHERE id = ?", [newStatus, req.session.username, userId]);
  logAudit(action === 'approve' ? 'APPROVE' : 'REJECT', req.session.userId, `${req.session.username} ${action === 'approve' ? '批准' : '拒绝'}用户 ${user.username}`);
  res.json({ success: true, message: action === 'approve' ? '已批准' : '已拒绝' });
});

// ===== 删除用户 =====
api.post('/admin/delete-user', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.body;
  const user = dbGet("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  if (user.role === 'admin') return res.json({ success: false, message: '不能删除管理员账号' });
  dbRun("DELETE FROM users WHERE id = ?", [userId]);
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
  const user = dbGet("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const hashed = await bcrypt.hash(newPassword, 10);
  dbRun("UPDATE users SET password = ? WHERE id = ?", [hashed, userId]);
  logAudit('RESET_PWD', req.session.userId, `重置用户 ${user.username} 的密码`);
  res.json({ success: true, message: '密码已重置' });
});

// ===== 审计日志 =====
api.get('/admin/audit-logs', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const logs = dbAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
  res.json({ success: true, logs });
});

// ===== 辅助：验证登录 =====
function requireAuth(req, res) {
  if (!req.session.userId) {
    res.json({ success: false, message: '请先登录' });
    return false;
  }
  return true;
}

// ===== 保存工具数据（自动创建或更新） =====
api.post('/data/save', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { moduleId, moduleName, data } = req.body;
  if (!moduleId) return res.json({ success: false, message: '模块ID不能为空' });
  try {
    const existing = dbGet("SELECT id FROM tool_data WHERE user_id = ? AND module_id = ?", [req.session.userId, moduleId]);
    if (existing) {
      dbRun("UPDATE tool_data SET module_name = ?, data = ?, updated_at = datetime('now') WHERE user_id = ? AND module_id = ?",
        [moduleName || moduleId, JSON.stringify(data), req.session.userId, moduleId]);
    } else {
      dbRun("INSERT INTO tool_data (id, user_id, module_id, module_name, data) VALUES (?, ?, ?, ?, ?)",
        [uuidv4(), req.session.userId, moduleId, moduleName || moduleId, JSON.stringify(data)]);
    }
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, message: '保存失败: ' + e.message });
  }
});

// ===== 加载工具数据 =====
api.get('/data/load/:moduleId', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { moduleId } = req.params;
  const row = dbGet("SELECT * FROM tool_data WHERE user_id = ? AND module_id = ?", [req.session.userId, moduleId]);
  if (!row) return res.json({ success: true, data: null });
  try {
    res.json({ success: true, data: JSON.parse(row.data), updated_at: row.updated_at });
  } catch(e) {
    res.json({ success: true, data: null });
  }
});

// ===== 加载当前用户所有工具进度 =====
api.get('/data/progress', (req, res) => {
  if (!requireAuth(req, res)) return;
  const rows = dbAll("SELECT module_id, module_name, updated_at FROM tool_data WHERE user_id = ? ORDER BY updated_at DESC", [req.session.userId]);
  res.json({ success: true, modules: rows });
});

// ===== 管理员：全局数据统计 =====
api.get('/admin/data-stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  // 各模块使用次数
  const moduleUsage = dbAll(`
    SELECT module_id, module_name, COUNT(*) as count,
           COUNT(DISTINCT user_id) as user_count,
           MAX(updated_at) as last_update
    FROM tool_data GROUP BY module_id ORDER BY count DESC
  `);
  // 活跃用户（有数据的用户）
  const activeUsers = dbGet("SELECT COUNT(DISTINCT user_id) as c FROM tool_data");
  // 近7天活跃
  const recentActive = dbGet("SELECT COUNT(DISTINCT user_id) as c FROM tool_data WHERE updated_at > datetime('now', '-7 days')");
  // 各模块统计
  const totalRecords = dbGet("SELECT COUNT(*) as c FROM tool_data");
  res.json({
    success: true,
    stats: {
      totalRecords: totalRecords?.c || 0,
      activeUsers: activeUsers?.c || 0,
      recentActive: recentActive?.c || 0,
      moduleUsage
    }
  });
});

// ===== 管理员：查看所有用户数据摘要 =====
api.get('/admin/users-data', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = dbAll(`
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
api.get('/admin/user-data/:userId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.params;
  const user = dbGet("SELECT id, username, email, company, status, created_at FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const rows = dbAll("SELECT module_id, module_name, updated_at FROM tool_data WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
  res.json({ success: true, user, modules: rows });
});

// ===== 管理员：导出指定用户单模块数据 =====
api.get('/admin/export-user-module/:userId/:moduleId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId, moduleId } = req.params;
  const row = dbGet("SELECT * FROM tool_data WHERE user_id = ? AND module_id = ?", [userId, moduleId]);
  if (!row) return res.json({ success: false, message: '无数据' });
  const user = dbGet("SELECT username FROM users WHERE id = ?", [userId]);
  try {
    res.json({ success: true, data: JSON.parse(row.data), module_name: row.module_name, username: user?.username });
  } catch(e) {
    res.json({ success: false, message: '数据解析失败' });
  }
});

// ===== 管理员：导出用户全部数据（JSON下载） =====
api.get('/admin/export-user-all/:userId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.params;
  const user = dbGet("SELECT username, email, company FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  const rows = dbAll("SELECT module_id, module_name, data, updated_at FROM tool_data WHERE user_id = ? ORDER BY updated_at", [userId]);
  const exportData = { user, records: rows.map(r => ({ ...r, data: JSON.parse(r.data) })) };
  res.setHeader('Content-Disposition', `attachment; filename="${user.username}_数据导出.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

// ===== 管理员：删除指定用户所有数据 =====
api.post('/admin/delete-user-data', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, message: '参数错误' });
  const user = dbGet("SELECT username FROM users WHERE id = ?", [userId]);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  dbRun("DELETE FROM tool_data WHERE user_id = ?", [userId]);
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
    console.log(`📋 注册需审批后方可登录\n`);
  });
}).catch(e => { console.error('启动失败:', e); process.exit(1); });

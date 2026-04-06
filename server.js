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

// ===== 审计日志 =====
api.get('/admin/audit-logs', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const logs = dbAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
  res.json({ success: true, logs });
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

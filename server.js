const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = parseInt(process.env.PORT) || 8899;

// ===== 检测数据库模式 =====
const USE_PG = !!(process.env.DATABASE_URL);
let pool = null;

// ===== PostgreSQL 模式（Railway 有 DATABASE_URL 时）=====
if (USE_PG) {
  try {
    const { Pool } = require('pg');
    const cfg = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
    pool = new Pool(cfg);
  } catch (e) {
    console.warn('⚠️  pg 模块加载失败，降级到文件存储');
  }
}

async function dbGet(sql, params = []) {
  if (USE_PG) {
    const res = await pool.query(sql, params);
    if (!res.rows.length) return null;
    const obj = {};
    res.fields.forEach((f, i) => obj[f.name] = res.rows[0][f.name]);
    return obj;
  }
  return fileStore.get(sql, params);
}

async function dbAll(sql, params = []) {
  if (USE_PG) {
    const res = await pool.query(sql, params);
    if (!res.rows.length) return [];
    const cols = res.fields.map(f => f.name);
    return res.rows.map(row => { const o = {}; cols.forEach((c, i) => o[c] = row[c]); return o; });
  }
  return fileStore.all(sql, params);
}

async function dbRun(sql, params = []) {
  if (USE_PG) {
    await pool.query(sql, params);
    return;
  }
  await fileStore.run(sql, params);
}

// ===== 文件存储模式（无 DATABASE_URL 时降级使用）=====
const DATA_DIR = path.join(process.cwd(), '.dts_data');
if (!USE_PG) {
  console.log('⚠️  未检测到 DATABASE_URL，使用文件存储于 .dts_data 目录');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) { return path.join(DATA_DIR, name + '.json'); }
function readJson(name) { try { return JSON.parse(fs.readFileSync(filePath(name), 'utf8')); } catch { return []; } }
function writeJson(name, data) { fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2)); }

const fileStore = {
  async get(sql, params) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  },
  async all(sql, params) {
    const users = readJson('users');
    const sessions = readJson('sessions');
    const audit = readJson('audit_logs');
    const tool = readJson('tool_data');
    // 简化路由
    if (sql.includes('FROM users') && sql.includes('WHERE username = $1')) {
      const idx = users.findIndex(u => u.username === params[0]);
      return idx >= 0 ? [users[idx]] : [];
    }
    if (sql.includes('FROM users') && sql.includes('WHERE role')) return users.filter(u => u.role === 'admin').slice(0, 1);
    if (sql.includes('FROM users') && sql.includes('LIMIT 1')) {
      const idx = params[0] ? users.findIndex(u => u.id === params[0]) : -1;
      return idx >= 0 ? [users[idx]] : [];
    }
    if (sql.includes('FROM users') && sql.includes('status = $1') && params[0] === 'pending') return users.filter(u => u.status === 'pending');
    if (sql.includes('FROM users') && sql.includes('ORDER BY created_at')) return users;
    if (sql.includes('FROM users') && sql.includes('WHERE id = $1')) {
      const idx = params[0] ? users.findIndex(u => u.id === params[0]) : -1;
      return idx >= 0 ? [users[idx]] : [];
    }
    // COUNT(*) 路由
    if (sql.includes('COUNT(*)') && sql.includes('FROM users') && !sql.includes('WHERE')) return [{ c: String(users.length) }];
    if (sql.includes('COUNT(*)') && sql.includes('status = $1') && params[0]) return [{ c: String(users.filter(u => u.status === params[0]).length) }];
    if (sql.includes('FROM sessions') && sql.includes('sid = $1')) {
      const now = Date.now();
      return sessions.filter(s => s.sid === params[0] && new Date(s.expires_at).getTime() > now);
    }
    if (sql.includes('FROM audit_logs') && sql.includes('ORDER BY')) return audit.slice(0, 100);
    if (sql.includes('FROM tool_data') && sql.includes('user_id = $1') && sql.includes('module_id = $2')) {
      const idx = tool.findIndex(t => t.user_id === params[0] && t.module_id === params[1]);
      return idx >= 0 ? [tool[idx]] : [];
    }
    if (sql.includes('FROM tool_data') && sql.includes('user_id = $1') && sql.includes('ORDER BY')) {
      return tool.filter(t => t.user_id === params[0]).sort((a,b) => new Date(b.updated_at)-new Date(a.updated_at));
    }
    if (sql.includes('FROM tool_data') && sql.includes('GROUP BY module_id')) {
      const grouped = {};
      tool.forEach(t => { if (!grouped[t.module_id]) grouped[t.module_id] = { module_id: t.module_id, module_name: t.module_name, count: 0, user_count: new Set(), last_update: t.updated_at };
        grouped[t.module_id].count++;
        grouped[t.module_id].user_count.add(t.user_id);
        if (new Date(t.updated_at) > new Date(grouped[t.module_id].last_update)) grouped[t.module_id].last_update = t.updated_at;
      });
      return Object.values(grouped).map(g => ({ ...g, user_count: g.user_count.size }));
    }
    if (sql.includes('COUNT(*)') && sql.includes('FROM users')) {
      const c = users.length;
      return [{ c: String(c) }];
    }
    if (sql.includes('COUNT(*)') && sql.includes('status = $1') && params[0]) {
      const c = users.filter(u => u.status === params[0]).length;
      return [{ c: String(c) }];
    }
    if (sql.includes('COUNT(DISTINCT user_id)') && sql.includes('FROM tool_data') && sql.includes('INTERVAL')) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const c = new Set(tool.filter(t => new Date(t.updated_at) > cutoff).map(t => t.user_id)).size;
      return [{ c: String(c) }];
    }
    if (sql.includes('COUNT(DISTINCT user_id)') && sql.includes('FROM tool_data')) {
      const c = new Set(tool.map(t => t.user_id)).size;
      return [{ c: String(c) }];
    }
    if (sql.includes('COUNT(*)') && sql.includes('FROM tool_data')) {
      return [{ c: String(tool.length) }];
    }
    return [];
  },
  async run(sql, params) {
    const users = readJson('users');
    const sessions = readJson('sessions');
    const audit = readJson('audit_logs');
    const tool = readJson('tool_data');
    if (sql.includes('INSERT INTO users')) {
      const id = params[0], username = params[1], password = params[2], email = params[3], role = params[4] || 'user', status = params[5] || 'pending';
      if (!users.find(u => u.username === username)) {
        users.push({ id, username, password, email, role, status, created_at: new Date().toISOString(), approved_at: role === 'admin' ? new Date().toISOString() : null });
        writeJson('users', users);
      }
      return;
    }
    if (sql.includes('INSERT INTO sessions')) {
      sessions.push({ sid: params[0], user_id: params[1], created_at: new Date().toISOString(), expires_at: params[2] });
      writeJson('sessions', sessions);
      return;
    }
    if (sql.includes('DELETE FROM sessions') && sql.includes('sid = $1')) {
      const idx = sessions.findIndex(s => s.sid === params[0]);
      if (idx >= 0) { sessions.splice(idx, 1); writeJson('sessions', sessions); }
      return;
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      audit.push({ id: params[0], action: params[1], user_id: params[2], detail: params[3], created_at: new Date().toISOString() });
      writeJson('audit_logs', audit);
      return;
    }
    if (sql.includes('INSERT INTO tool_data')) {
      tool.push({ id: params[0], user_id: params[1], module_id: params[2], module_name: params[3], data: params[4], updated_at: new Date().toISOString() });
      writeJson('tool_data', tool);
      return;
    }
    if (sql.includes('UPDATE tool_data SET')) {
      const idx = tool.findIndex(t => t.user_id === params[1] && t.module_id === params[2]);
      if (idx >= 0) { tool[idx].module_name = params[0]; tool[idx].data = params[1+1+1]; tool[idx].updated_at = new Date().toISOString(); writeJson('tool_data', tool); }
      return;
    }
    if (sql.includes('UPDATE users SET status')) {
      const idx = users.findIndex(u => u.id === params[2]);
      if (idx >= 0) { users[idx].status = params[0]; users[idx].approved_at = new Date().toISOString(); users[idx].approved_by = params[1]; writeJson('users', users); }
      return;
    }
    if (sql.includes('UPDATE users SET password')) {
      const idx = users.findIndex(u => u.id === params[1]);
      if (idx >= 0) { users[idx].password = params[0]; writeJson('users', users); }
      return;
    }
    if (sql.includes('DELETE FROM users')) {
      const idx = users.findIndex(u => u.id === params[0]);
      if (idx >= 0) { users.splice(idx, 1); writeJson('users', users); }
      return;
    }
    if (sql.includes('DELETE FROM tool_data')) {
      const filtered = tool.filter(t => t.user_id !== params[0]);
      writeJson('tool_data', filtered);
      return;
    }
  }
};

// ===== 初始化数据库表 =====
async function initDB() {
  if (USE_PG) {
    // PostgreSQL 初始化
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        email TEXT DEFAULT '', company TEXT DEFAULT '', role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP, approved_by TEXT
      )
    `);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, user_id TEXT, created_at TIMESTAMP DEFAULT NOW(), expires_at TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, user_id TEXT DEFAULT '', detail TEXT DEFAULT '', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tool_data (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, module_id TEXT NOT NULL, module_name TEXT DEFAULT '', data TEXT DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, module_id))`);
    // 创建超级管理员
    const admin = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin.rows.length === 0) {
      const hash = bcrypt.hashSync('DTS@Admin2026', 10);
      await pool.query("INSERT INTO users (id, username, password, email, role, status, approved_at, approved_by) VALUES ($1, $2, $3, $4, 'admin', 'approved', NOW(), 'system')", [uuidv4(), 'admin', hash, '282727653@qq.com']);
      console.log('✅ 超级管理员已创建: admin / DTS@Admin2026');
    }
    console.log('✅ PostgreSQL 数据库初始化完成');
  } else {
    // 文件存储初始化：确保数据目录存在
    ['users', 'sessions', 'audit_logs', 'tool_data'].forEach(f => {
      const p = path.join(DATA_DIR, f + '.json');
      if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
    });
    // 创建超级管理员（文件模式）
    const users = readJson('users');
    if (!users.find(u => u.role === 'admin')) {
      const hash = bcrypt.hashSync('DTS@Admin2026', 10);
      users.push({ 
        id: uuidv4(), 
        username: 'admin', 
        password: hash, 
        email: '282727653@qq.com', 
        role: 'admin', 
        status: 'approved',
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        approved_by: 'system'
      });
      writeJson('users', users);
      console.log('✅ 超级管理员已创建（文件模式）: admin / DTS@Admin2026');
    } else {
      // 确保现有 admin 状态为 approved
      const adminIdx = users.findIndex(u => u.role === 'admin' && u.status !== 'approved');
      if (adminIdx >= 0) {
        users[adminIdx].status = 'approved';
        users[adminIdx].approved_at = new Date().toISOString();
        users[adminIdx].approved_by = 'system';
        writeJson('users', users);
        console.log('✅ 已修复 admin 账号状态为 approved');
      }
    }
    console.log('⚠️  未检测到 DATABASE_URL，使用文件存储（数据保存在容器 /tmp/dts_data，重启后清空）');
    console.log('   如需持久化，请在 Railway 添加 PostgreSQL 插件');
  }
}

async function logAudit(action, userId, detail) {
  try {
    await dbRun(
      "INSERT INTO audit_logs (id, action, user_id, detail, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [uuidv4(), action, userId || '', detail]
    );
  } catch (e) {}
}

// ===== 健康检查（Railway 需要根路径可访问）=====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: USE_PG ? 'postgresql' : 'file-storage', time: new Date().toISOString() });
});
app.get('/', (req, res, next) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

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
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 企业数字化转型规划系统`);
    console.log(`📍 监听端口: ${PORT}`);
    console.log(`👤 管理员: admin / DTS@Admin2026`);
    console.log(`📋 注册需审批后方可登录`);
    console.log(`🗄️  数据库: ${USE_PG ? 'PostgreSQL' : '文件存储（无持久化）'}`);
  });
  server.on('error', (e) => { console.error('❌ 服务器错误:', e.message); });
}).catch(e => {
  console.error('⚠️  initDB 异常，强制启动:', e.message);
  ['users', 'sessions', 'audit_logs', 'tool_data'].forEach(f => { const p = path.join(DATA_DIR, f + '.json'); if (!fs.existsSync(p)) fs.writeFileSync(p, '[]'); });
  const users = readJson('users');
  if (!users.find(u => u.role === 'admin')) {
    const hash = bcrypt.hashSync('DTS@Admin2026', 10);
    users.push({ id: uuidv4(), username: 'admin', password: hash, email: '282727653@qq.com', role: 'admin', status: 'approved', created_at: new Date().toISOString(), approved_at: new Date().toISOString(), approved_by: 'system' });
    writeJson('users', users);
    console.log('✅ 超级管理员已创建（catch降级）: admin / DTS@Admin2026');
  } else {
    // 确保现有 admin 状态为 approved
    const adminIdx = users.findIndex(u => u.role === 'admin' && u.status !== 'approved');
    if (adminIdx >= 0) {
      users[adminIdx].status = 'approved';
      users[adminIdx].approved_at = new Date().toISOString();
      users[adminIdx].approved_by = 'system';
      writeJson('users', users);
      console.log('✅ 已修复 admin 账号状态为 approved');
    }
  }
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 企业数字化转型规划系统（强制启动）`);
    console.log(`📍 监听端口: ${PORT}`);
  });
  server.on('error', (e) => { console.error('❌ 服务器错误:', e.message); });
});

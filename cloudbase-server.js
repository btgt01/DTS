// 腾讯云 CloudBase 云函数 - 用户认证系统
// 无需额外依赖，使用 CloudBase 内置 SDK

function hashPassword(password) {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = ((h << 5) - h + password.charCodeAt(i)) | 0;
  }
  return 'h_' + Math.abs(h).toString(16);
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

exports.main = async (event, context) => {
  // 获取 CloudBase 数据库实例
  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({
    env: cloudbase.SYMBOL_CURRENT_ENV
  });
  const db = app.database();
  const _ = db.command;
  
  const { httpMethod, path, headers, body, query } = event;
  
  const resHeader = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  try {
    // CORS 预检
    if (httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: resHeader, body: '{}' };
    }

    // 解析请求体
    let reqBody = {};
    if (body) {
      try { 
        reqBody = typeof body === 'string' ? JSON.parse(body) : body; 
      } catch(e) {}
    }

    // ===== 用户注册 =====
    if (httpMethod === 'POST' && path === '/api/register') {
      const { username, password, email, company } = reqBody;
      
      if (!username || !password) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '用户名和密码不能为空' }) };
      }
      
      if (password.length < 6) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '密码至少6位' }) };
      }
      
      // 检查用户名是否已存在
      const existing = await db.collection('dts_users').where({ username }).count();
      if (existing.total > 0) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '用户名已存在' }) };
      }
      
      // 创建新用户
      const id = generateId();
      await db.collection('dts_users').add({
        id,
        username,
        password: hashPassword(password),
        email: email || '',
        company: company || '',
        role: 'user',
        status: 'pending',
        created_at: new Date().toISOString()
      });
      
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ 
        success: true, 
        message: '注册成功！请等待管理员审批后登录。' 
      }) };
    }

    // ===== 用户登录 =====
    if (httpMethod === 'POST' && path === '/api/login') {
      const { username, password } = reqBody;
      
      if (!username || !password) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '请输入用户名和密码' }) };
      }
      
      const result = await db.collection('dts_users').where({ username }).get();
      
      if (!result.data || result.data.length === 0) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '用户名或密码错误' }) };
      }
      
      const user = result.data[0];
      
      if (user.status === 'pending') {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '账号正在等待审批，请联系管理员。' }) };
      }
      
      if (user.status === 'rejected') {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '账号审批未通过，请联系管理员。' }) };
      }
      
      if (!verifyPassword(password, user.password)) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '用户名或密码错误' }) };
      }
      
      // 创建会话
      const token = generateId() + generateId();
      await db.collection('dts_sessions').add({
        token,
        user_id: user.id,
        username: user.username,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
      
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({
        success: true,
        token,
        user: { id: user.id, username: user.username, email: user.email, company: user.company, role: user.role }
      })};
    }

    // ===== 验证登录状态 =====
    if (httpMethod === 'GET' && path === '/api/check') {
      const token = headers['authorization'] || query.token || '';
      
      if (!token) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ loggedIn: false }) };
      }
      
      const sessions = await db.collection('dts_sessions').where({ token }).get();
      
      if (!sessions.data || sessions.data.length === 0) {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ loggedIn: false }) };
      }
      
      const session = sessions.data[0];
      
      // 检查会话是否过期
      if (new Date(session.expires_at) < new Date()) {
        await db.collection('dts_sessions').doc(sessions.data[0]._id).remove();
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ loggedIn: false }) };
      }
      
      const users = await db.collection('dts_users').where({ id: session.user_id }).get();
      
      if (!users.data || users.data.length === 0 || users.data[0].status !== 'approved') {
        return { statusCode: 200, headers: resHeader, body: JSON.stringify({ loggedIn: false }) };
      }
      
      const user = users.data[0];
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ 
        loggedIn: true, 
        user: { id: user.id, username: user.username, email: user.email, company: user.company, role: user.role } 
      }) };
    }

    // ===== 登出 =====
    if (httpMethod === 'POST' && path === '/api/logout') {
      const token = headers['authorization'] || '';
      
      if (token) {
        const sessions = await db.collection('dts_sessions').where({ token }).get();
        if (sessions.data && sessions.data.length > 0) {
          await db.collection('dts_sessions').doc(sessions.data[0]._id).remove();
        }
      }
      
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: true }) };
    }

    // ===== 管理员验证辅助函数 =====
    const verifyAdmin = async () => {
      const token = headers['authorization'] || '';
      if (!token) return null;
      
      const sessions = await db.collection('dts_sessions').where({ token }).get();
      if (!sessions.data || sessions.data.length === 0) return null;
      
      const users = await db.collection('dts_users').where({ id: sessions.data[0].user_id }).get();
      if (!users.data || users.data.length === 0) return null;
      
      return users.data[0].role === 'admin' ? users.data[0] : null;
    };

    // ===== 获取待审批用户 =====
    if (httpMethod === 'GET' && path === '/api/admin/pending-users') {
      const admin = await verifyAdmin();
      if (!admin) return { statusCode: 401, headers: resHeader, body: JSON.stringify({ success: false, message: '需要管理员权限' }) };
      
      const result = await db.collection('dts_users').where({ status: 'pending' }).orderBy('created_at', 'desc').get();
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: true, users: result.data || [] }) };
    }

    // ===== 获取所有用户 =====
    if (httpMethod === 'GET' && path === '/api/admin/all-users') {
      const admin = await verifyAdmin();
      if (!admin) return { statusCode: 401, headers: resHeader, body: JSON.stringify({ success: false, message: '需要管理员权限' }) };
      
      const result = await db.collection('dts_users').orderBy('created_at', 'desc').get();
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: true, users: result.data || [] }) };
    }

    // ===== 审批用户 =====
    if (httpMethod === 'POST' && path === '/api/admin/approve-user') {
      const admin = await verifyAdmin();
      if (!admin) return { statusCode: 401, headers: resHeader, body: JSON.stringify({ success: false, message: '需要管理员权限' }) };
      
      const { userId, action } = reqBody;
      if (!userId || !action) return { statusCode: 200, headers: resHeader, body: JSON.stringify({ success: false, message: '参数错误' }) };
      
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await db.collection('dts_users').where({ id: userId }).update({ 
        status: newStatus, 
        approved_at: new Date().toISOString(), 
        approved_by: admin.username 
      });
      
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ 
        success: true, 
        message: action === 'approve' ? '已批准' : '已拒绝' 
      }) };
    }

    // ===== 仪表盘统计 =====
    if (httpMethod === 'GET' && path === '/api/admin/stats') {
      const admin = await verifyAdmin();
      if (!admin) return { statusCode: 401, headers: resHeader, body: JSON.stringify({ success: false, message: '需要管理员权限' }) };
      
      const total = await db.collection('dts_users').count();
      const pending = await db.collection('dts_users').where({ status: 'pending' }).count();
      const approved = await db.collection('dts_users').where({ status: 'approved' }).count();
      const rejected = await db.collection('dts_users').where({ status: 'rejected' }).count();
      
      return { statusCode: 200, headers: resHeader, body: JSON.stringify({ 
        success: true, 
        stats: { total: total.total, pending: pending.total, approved: approved.total, rejected: rejected.total } 
      }) };
    }

    return { statusCode: 404, headers: resHeader, body: JSON.stringify({ message: 'API not found' }) };

  } catch (e) {
    console.error('CloudBase Error:', e);
    return { statusCode: 500, headers: resHeader, body: JSON.stringify({ success: false, message: '服务器错误: ' + e.message }) };
  }
};

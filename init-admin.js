/**
 * CloudBase 管理员初始化脚本
 * 首次部署后运行，创建超级管理员账号
 */
const cloudbase = require('@cloudbase/node-sdk');

async function initAdmin() {
  const env = cloudbase.init({
    env: process.env.TCB_ENV_ID  // 通过环境变量获取
  });
  const db = env.database();
  
  const adminUsername = 'admin';
  const adminPassword = 'DTS@Admin2026';  // 请首次登录后修改！
  const adminEmail = '282727653@qq.com';
  
  // 简单hash函数
  function hashPassword(password) {
    let h = 0;
    for (let i = 0; i < password.length; i++) {
      h = ((h << 5) - h + password.charCodeAt(i)) | 0;
    }
    return 'h_' + Math.abs(h).toString(16);
  }
  
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
  
  try {
    // 检查是否已存在管理员
    const existing = await db.collection('dts_users').where({ username: adminUsername }).get();
    
    if (existing.data && existing.data.length > 0) {
      console.log('管理员账号已存在，跳过创建');
      return;
    }
    
    // 创建管理员账号
    const id = generateId();
    await db.collection('dts_users').add({
      id,
      username: adminUsername,
      password: hashPassword(adminPassword),
      email: adminEmail,
      company: '系统管理',
      role: 'admin',
      status: 'approved',
      created_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: 'system'
    });
    
    console.log('========================================');
    console.log('✅ 超级管理员账号创建成功！');
    console.log('========================================');
    console.log(`用户名: ${adminUsername}`);
    console.log(`密码: ${adminPassword}`);
    console.log(`邮箱: ${adminEmail}`);
    console.log('========================================');
    console.log('⚠️  首次登录后请立即修改密码！');
    console.log('========================================');
    
  } catch (e) {
    console.error('初始化失败:', e.message);
    process.exit(1);
  }
}

initAdmin();

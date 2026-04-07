/**
 * 工具数据 API - 服务器端持久化
 * 所有工具通过 loadToolData / saveToolData 读写数据
 * 优先使用服务器 API，localStorage 仅作临时缓存
 */

const _toolApiBase = '/api';

// 从 Cookie 获取 sid
function _getSid() {
  const match = document.cookie.match(/dts_sid=([^;]+)/);
  return match ? match[1] : '';
}

// 获取带认证的请求头
function _authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Session-Id': _getSid()
  };
}

// 异步加载工具数据
// 返回 { data: Object|null, updated_at: string|null }
async function loadToolData(moduleId) {
  try {
    const res = await fetch(_toolApiBase + '/data/load/' + encodeURIComponent(moduleId), {
      credentials: 'include'
    });
    if (res.ok) {
      const d = await res.json();
      if (d.success && d.data !== null) {
        // 同步到本地缓存
        localStorage.setItem('_tool_' + moduleId, JSON.stringify(d.data));
        return { data: d.data, updated_at: d.updated_at, fromServer: true };
      }
    }
  } catch(e) {
    // 网络错误，尝试 localStorage
  }
  // 回退：尝试从本地缓存加载
  const cached = localStorage.getItem('_tool_' + moduleId);
  if (cached) {
    try { return { data: JSON.parse(cached), updated_at: null, fromServer: false }; }
    catch(e) { return { data: null, updated_at: null, fromServer: false }; }
  }
  return { data: null, updated_at: null, fromServer: false };
}

// 异步保存工具数据
async function saveToolData(moduleId, data, moduleName) {
  moduleName = moduleName || moduleId;
  // 同时更新本地缓存（临时）
  localStorage.setItem('_tool_' + moduleId, JSON.stringify(data));
  try {
    const res = await fetch(_toolApiBase + '/data/save', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId, moduleName, data })
    });
    if (res.ok) {
      const d = await res.json();
      return { success: d.success, fromServer: true };
    }
  } catch(e) {
    // 网络错误，数据已在 localStorage
  }
  return { success: true, fromServer: false }; // localStorage 兜底
}

// 获取当前用户各模块进度
async function getUserProgress() {
  try {
    const res = await fetch(_toolApiBase + '/data/progress', { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      if (d.success) return d.modules || [];
    }
  } catch(e) {}
  return [];
}

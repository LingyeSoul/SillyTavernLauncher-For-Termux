/**
 * SillyTavern WebUI API 客户端
 * 提供与后端通信的接口
 */

class API {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
    }

    /**
     * 通用请求方法
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            ...options
        };

        try {
            const response = await fetch(url, defaultOptions);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return { success: true, data: await response.text() };
            }
        } catch (error) {
            console.error(`API请求失败 [${endpoint}]:`, error);
            return {
                success: false,
                error: error.message,
                message: error.message
            };
        }
    }

    // SillyTavern 控制接口
    async installSillyTavern() {
        return await this.request('/sillytavern/install', { method: 'POST' });
    }

    async startSillyTavern() {
        return await this.request('/sillytavern/start', { method: 'POST' });
    }

    async updateSillyTavern() {
        return await this.request('/sillytavern/update', { method: 'POST' });
    }

    async stopSillyTavern() {
        return await this.request('/sillytavern/stop', { method: 'POST' });
    }

    // 启动器控制接口
    async updateLauncher() {
        return await this.request('/launcher/update', { method: 'POST' });
    }

    async restartLauncher() {
        return await this.request('/launcher/restart', { method: 'POST' });
    }

    // 配置管理接口
    async getConfig() {
        return await this.request('/config');
    }

    async setMirror(mirror) {
        return await this.request('/config/mirror', {
            method: 'POST',
            body: JSON.stringify({ mirror })
        });
    }

    async saveSTConfig(port, listenAll) {
        return await this.request('/config/sillytavern', {
            method: 'POST',
            body: JSON.stringify({ port, listenAll })
        });
    }

    async setAutostart(enabled) {
        return await this.request('/config/autostart', {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
    }

    // 同步服务器接口
    async startSyncServer(port, host) {
        return await this.request('/sync/start', {
            method: 'POST',
            body: JSON.stringify({ port, host })
        });
    }

    async stopSyncServer() {
        return await this.request('/sync/stop', { method: 'POST' });
    }

    async getSyncServerStatus() {
        return await this.request('/sync/status');
    }

    async syncFromServer(serverUrl, method = 'auto', backup = true) {
        return await this.request('/sync/from-server', {
            method: 'POST',
            body: JSON.stringify({ serverUrl, method, backup })
        });
    }

    // 系统状态接口
    async getSystemStatus() {
        return await this.request('/status');
    }

    // Socket.IO 实时日志接口
    connectWebSocket(onMessage, onError, onClose) {
        try {
            // 使用 Socket.IO 连接
            const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });

            socket.on('connect', () => {
                console.log('Socket.IO 连接成功:', socket.id);
                onMessage({ type: 'connect', data: { id: socket.id } });
            });

            socket.on('disconnect', () => {
                console.log('Socket.IO 连接断开');
                onClose({ reason: 'disconnect' });
            });

            socket.on('log', (data) => {
                onMessage(data);
            });

            socket.on('connect_error', (error) => {
                console.error('Socket.IO 连接错误:', error);
                onError(error);
            });

            socket.on('heartbeat_response', (data) => {
                onMessage({ type: 'heartbeat', data });
            });

            // 添加心跳检测
            this._heartbeatInterval = setInterval(() => {
                socket.emit('heartbeat');
            }, 30000);

            return socket;
        } catch (error) {
            console.error('创建Socket.IO连接失败:', error);
            onError(error);
            return null;
        }
    }

    // 断开Socket.IO连接
    disconnectWebSocket(socket) {
        try {
            if (socket && socket.disconnect) {
                socket.disconnect();
            }
            if (this._heartbeatInterval) {
                clearInterval(this._heartbeatInterval);
                this._heartbeatInterval = null;
            }
        } catch (error) {
            console.error('断开Socket.IO连接失败:', error);
        }
    }

    // 批量操作接口
    async installAll() {
        return await this.request('/install-all', { method: 'POST' });
    }

    async quickStart() {
        return await this.request('/quick-start', { method: 'POST' });
    }

    // 工具方法
    async testConnection() {
        return await this.request('/ping');
    }

    async getVersion() {
        return await this.request('/version');
    }
}

// 创建全局API实例
const apiInstance = new API();

// 确保所有方法都正确绑定到实例上
Object.getOwnPropertyNames(API.prototype).forEach(methodName => {
    if (typeof API.prototype[methodName] === 'function' && methodName !== 'constructor') {
        apiInstance[methodName] = apiInstance[methodName].bind(apiInstance);
    }
});

// 导出API类和实例（用于模块化）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_Class: API, API_Instance: apiInstance };
} else {
    // 确保在浏览器环境中也能正确设置全局API对象
    window.API = apiInstance;
    window.API_Class = API;
}

// 为了确保兼容性，也设置一个全局变量
window.SillyTavernAPI = apiInstance;
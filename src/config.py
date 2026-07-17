import copy
import json
import os
import secrets

from utils.sync_common import ALL_INTERFACES


class ConfigManager:
    def __init__(self, config_path=None):
        """
        初始化配置管理器
        
        Args:
            config_path (str, optional): 配置文件路径，默认为当前目录下的config.json
        """
        if config_path is None:
            self.config_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config.json"))
        else:
            self.config_path = config_path
        self.default_config = {
                "first_run": True,
                "github": {
                    "mirror": "github",  # 支持: github, ghproxy, ghllkk, 或自定义域名
                    "custom_mirror_url": ""  # 自定义镜像 URL（当 mirror 不是预设值时使用）
                },
                "autostart": False,
                "sync": {
                    "enabled": False,
                    "port": 9999,
                    "host": ALL_INTERFACES,
                },
                "migration": {
                    "last_migration_time": None,
                    "last_source_path": None,
                    "backup_enabled": True,
                    "preferred_mode": "move"
                },
                "agreement_accepted": False,
                "agreement_version": "",
                "downloads": [],
                "has_started_st": False,
                "agreement_history": []
                }
        self.config = self.load_config()
        self._merge_defaults(self.config, self.default_config)
        if not self.get("sync.token"):
            self.set("sync.token", secrets.token_urlsafe(24))
        
        
    def load_config(self):
        """
        加载配置文件
        
        Returns:
            dict: 配置字典
        """
        # 如果配置文件不存在，创建默认配置
        if not os.path.exists(self.config_path):

            self.save_config(self.default_config)
            return self.default_config
        
        # 读取现有配置
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            # 如果读取失败，返回默认配置
            print(f"警告: 读取配置文件失败，使用默认配置: {e}")
            return self.default_config
    
    def save_config(self, config_data=None):
        """
        保存配置到文件
        
        Args:
            config_data (dict, optional): 要保存的配置数据，默认使用实例中的config
        """
        if config_data is None:
            config_data = self.config
            
        temp_path = f"{self.config_path}.tmp"
        try:
            parent = os.path.dirname(os.path.abspath(self.config_path))
            os.makedirs(parent, exist_ok=True)
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(config_data, f, ensure_ascii=False, indent=4)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, self.config_path)
            os.chmod(self.config_path, 0o600)
        except Exception as e:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass
            raise Exception(f"保存配置文件失败: {str(e)}")

    def _merge_defaults(self, current, defaults):
        """递归补齐缺失配置，同时保留用户已有设置。"""
        changed = False
        for key, value in defaults.items():
            if key not in current:
                current[key] = copy.deepcopy(value)
                changed = True
            elif isinstance(value, dict) and isinstance(current[key], dict):
                changed = self._merge_defaults(current[key], value) or changed
        return changed
    
    def get(self, key, default=None):
        """
        获取配置项的值
        
        Args:
            key (str): 配置项键名，支持点号分隔的嵌套键名，如 "github.mirror"
            default: 默认值
            
        Returns:
            配置项的值或默认值
        """
        keys = key.split('.')
        value = self.config
        
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            return default
    
    def set(self, key, value):
        """
        设置配置项的值
        
        Args:
            key (str): 配置项键名，支持点号分隔的嵌套键名，如 "github.mirror"
            value: 要设置的值
        """
        keys = key.split('.')
        config_data = self.config
        
        # 逐层导航到目标位置
        for k in keys[:-1]:
            if k not in config_data or not isinstance(config_data[k], dict):
                config_data[k] = {}
            config_data = config_data[k]
        
        # 设置最终值
        config_data[keys[-1]] = value
    
    def update(self, updates):
        """
        批量更新配置项
        
        Args:
            updates (dict): 要更新的配置项字典
        """
        for key, value in updates.items():
            self.set(key, value)
    
    def reload(self):
        """
        重新加载配置文件
        """
        self.config = self.load_config()
        self._merge_defaults(self.config, self.default_config)

    def current_sync_token(self):
        """读取当前同步令牌，使运行中的服务器可即时响应令牌轮换。"""
        self.reload()
        token = self.get("sync.token", "")
        if not isinstance(token, str) or not token:
            token = self.rotate_sync_token()
        return token

    def rotate_sync_token(self):
        """生成并持久化新的高熵同步令牌。"""
        token = secrets.token_urlsafe(24)
        self.set("sync.token", token)
        self.save_config()
        return token
    
    def _detect_env_type(self):
        """
        检测环境类型（是否使用系统环境）
        
        Returns:
            bool: True表示使用系统环境，False表示使用内置环境
        """
        if os.path.exists(os.path.join(os.getcwd(), "env\\")):
            return False
        else:
            return True


# 全局配置管理器实例
config_manager = ConfigManager()

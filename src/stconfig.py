import os
from ruamel.yaml import YAML


class stcfg:
    def __init__(self):
        self.base_dir = os.path.join(os.getcwd(), "SillyTavern")
        self.config_path = os.path.join(self.base_dir, "config.yaml")
        self.whitelist_path = os.path.join(self.base_dir, "whitelist.txt")
        self.listen = False
        self.port = 8000
        
        # 初始化YAML处理对象
        self.yaml = YAML()
        self.yaml.preserve_quotes = True
            
        self.config_data = {}
        self.load_config()

    def load_config(self):
        try:
            with open(self.config_path, 'r', encoding='utf-8') as file:
                self.config_data = self.yaml.load(file) or {}
                    
                # 保留原始配置内容
                self.listen = self.config_data.get('listen', False)
                self.port = self.config_data.get('port', 8000)
                # 仅加载 listen 和 port 配置
                pass
        except FileNotFoundError:
            # 配置文件不存在，使用默认值
            pass
        except Exception as e:
            print(f"加载配置文件时出错: {e}")


    def save_config(self):
        try:
            # 确保目录存在
            os.makedirs(self.base_dir, exist_ok=True)
            
            # 更新配置数据
            self.config_data['listen'] = self.listen
            self.config_data['port'] = self.port
            
            # 保存到文件
            with open(self.config_path, 'w', encoding='utf-8') as file:
                self.yaml.dump(self.config_data, file)
                
        except Exception as e:
            print(f"保存配置文件时出错: {e}")

    def create_whitelist(self):
        if not os.path.exists(self.whitelist_path):
            try:
                # 确保目标目录存在
                os.makedirs(os.path.dirname(self.whitelist_path), exist_ok=True)
                with open(self.whitelist_path, 'w', encoding='utf-8') as f:
                    f.write("192.168.*.*\n127.0.0.1\n")
            except Exception as e:
                print(f"白名单文件创建失败: {str(e)}")

    def set(self, key, value):
        """设置配置项"""
        if hasattr(self, key):
            setattr(self, key, value)
            self.config_data[key] = value
        else:
            raise AttributeError(f"配置项 '{key}' 不存在")

    def get(self, key, default=None):
        """获取配置项"""
        return getattr(self, key, default)

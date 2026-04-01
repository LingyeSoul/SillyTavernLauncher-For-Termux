"""
镜像 URL 构建器模块

提供统一的 GitHub 镜像 URL 构建功能
"""

from .url_converter import convert_gitee_to_github


class MirrorBuilder:
    """镜像 URL 构建器"""

    # GitHub 官方仓库地址
    GITHUB_REPOS = {
        "sillytavern": "https://github.com/SillyTavern/SillyTavern",
        "launcher": "https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux",
    }

    # 内置镜像源列表（按推荐顺序）
    MIRROR_LIST = [
        ("github", "github.com (官方源)"),
        ("ghproxy", "gh-proxy.org"),
        ("ghllkk", "gh.llkk.cc"),
    ]

    # 内置镜像源模板
    MIRROR_TEMPLATES = {
        "github": "https://github.com/{org}/{repo}",
        "ghproxy": "https://gh-proxy.org/https://github.com/{org}/{repo}",
        "ghllkk": "https://gh.llkk.cc/https://github.com/{org}/{repo}",
    }

    # Raw 文件镜像源模板（使用 raw.githubusercontent.com）
    RAW_MIRROR_TEMPLATES = {
        "github": "https://raw.githubusercontent.com/{org}/{repo}",
        "ghproxy": "https://gh-proxy.org/https://raw.githubusercontent.com/{org}/{repo}",
        "ghllkk": "https://gh.llkk.cc/https://raw.githubusercontent.com/{org}/{repo}",
    }

    # 键名到域名的映射
    KEY_TO_DOMAIN = {
        "github": "github.com",
        "ghproxy": "gh-proxy.org",
        "ghllkk": "gh.llkk.cc",
    }

    # 域名到键名的映射（支持完整域名作为 mirror 参数）
    DOMAIN_TO_KEY = {v: k for k, v in KEY_TO_DOMAIN.items()}

    # 支持的镜像源列表（键名）
    SUPPORTED_MIRRORS = [m[0] for m in MIRROR_LIST]

    @staticmethod
    def normalize_mirror(mirror: str) -> str:
        """
        将域名规范化为键名

        Args:
            mirror: 镜像源（可以是键名或域名）

        Returns:
            规范化的键名
        """
        if mirror in MirrorBuilder.MIRROR_TEMPLATES:
            return mirror
        return MirrorBuilder.DOMAIN_TO_KEY.get(mirror, mirror)

    @staticmethod
    def get_display_name(mirror: str) -> str:
        """
        获取镜像的显示名称

        Args:
            mirror: 镜像源（键名或域名）

        Returns:
            显示名称
        """
        # 如果是键名，转换为域名
        if mirror in MirrorBuilder.KEY_TO_DOMAIN:
            return MirrorBuilder.KEY_TO_DOMAIN[mirror]
        return mirror

    @staticmethod
    def build_git_url(org: str, repo: str, mirror: str = "github") -> str:
        """
        构建 git clone URL

        Args:
            org: 组织/用户名
            repo: 仓库名
            mirror: 镜像源 (键名如 "github", "ghproxy" 或完整域名如 "gh-proxy.org")

        Returns:
            完整的 git clone URL
        """
        # 规范化 mirror 参数
        mirror = MirrorBuilder.normalize_mirror(mirror)

        if mirror == "github":
            return f"https://github.com/{org}/{repo}.git"
        elif mirror in MirrorBuilder.MIRROR_TEMPLATES:
            template = MirrorBuilder.MIRROR_TEMPLATES[mirror]
            return template.format(org=org, repo=repo) + ".git"
        else:
            # 自定义镜像 URL
            return f"https://{mirror}/https://github.com/{org}/{repo}.git"

    @staticmethod
    def build_raw_url(org: str, repo: str, branch: str = "main", path: str = "", mirror: str = "github") -> str:
        """
        构建 raw 文件 URL

        Args:
            org: 组织/用户名
            repo: 仓库名
            branch: 分支名
            path: 文件路径
            mirror: 镜像源

        Returns:
            完整的 raw 文件 URL
        """
        # 规范化 mirror 参数
        mirror = MirrorBuilder.normalize_mirror(mirror)

        if mirror == "github":
            return f"https://raw.githubusercontent.com/{org}/{repo}/{branch}/{path}"
        elif mirror in MirrorBuilder.RAW_MIRROR_TEMPLATES:
            # 使用 raw 模板构建
            template = MirrorBuilder.RAW_MIRROR_TEMPLATES[mirror]
            base = template.replace("{org}", org).replace("{repo}", repo)
            return base + f"/{branch}/{path}"
        else:
            # 自定义镜像 URL
            return f"https://{mirror}/https://raw.githubusercontent.com/{org}/{repo}/{branch}/{path}"

    @staticmethod
    def get_github_url(org: str, repo: str) -> str:
        """
        获取 GitHub 仓库 URL

        Args:
            org: 组织/用户名
            repo: 仓库名

        Returns:
            GitHub 仓库 URL
        """
        return f"https://github.com/{org}/{repo}"

    @staticmethod
    def build_url(url: str, mirror: str = "github") -> str:
        """
        根据镜像源构建 URL

        Args:
            url: 原始 GitHub URL
            mirror: 镜像源

        Returns:
            使用指定镜像的 URL
        """
        # 先转换为 GitHub URL（处理可能的 Gitee URL）
        url = convert_gitee_to_github(url)

        # 规范化 mirror 参数
        mirror = MirrorBuilder.normalize_mirror(mirror)

        if mirror == "github":
            return url
        elif mirror in MirrorBuilder.MIRROR_TEMPLATES:
            # 提取 org 和 repo
            if "github.com/" in url:
                parts = url.replace("https://github.com/", "").replace("http://github.com/", "").split("/")
                if len(parts) >= 2:
                    org = parts[0]
                    repo = parts[1].replace(".git", "").replace("/", "")
                    template = MirrorBuilder.MIRROR_TEMPLATES[mirror]
                    return template.format(org=org, repo=repo)
        return url

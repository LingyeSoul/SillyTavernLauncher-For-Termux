"""
URL 转换工具模块

提供 Gitee URL 到 GitHub URL 的转换功能
"""

# Gitee 仓库到 GitHub 仓库的映射表
GITEE_TO_GITHUB_MAP = {
    "gitee.com/lingyesoul/SillyTavern": "github.com/SillyTavern/SillyTavern",
    "gitee.com/lingyesoul/SillyTavernLauncher-For-Termux": "github.com/LingyeSoul/SillyTavernLauncher-For-Termux",
}


def convert_gitee_to_github(url: str) -> str:
    """
    将 Gitee URL 转换为 GitHub URL

    Args:
        url: 原始 URL，可以是 Gitee 或 GitHub URL

    Returns:
        转换后的 GitHub URL
    """
    for gitee, github in GITEE_TO_GITHUB_MAP.items():
        if gitee in url:
            return url.replace(gitee, github)
    return url

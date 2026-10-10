/**
 * GitHub 镜像管理 — 构建镜像 URL + gitconfig insteadOf 全局重写。
 * ← src/utils/mirror_builder.py + url_converter.py + main_cli.set_github_mirror。
 */
import { run } from "./runtime.ts";

const GITEE_TO_GITHUB_MAP: Record<string, string> = {
  "gitee.com/lingyesoul/SillyTavern": "github.com/SillyTavern/SillyTavern",
  "gitee.com/lingyesoul/SillyTavernLauncher-For-Termux": "github.com/LingyeSoul/SillyTavernLauncher-For-Termux",
};

export function convertGiteeToGithub(url: string): string {
  for (const [gitee, github] of Object.entries(GITEE_TO_GITHUB_MAP)) {
    if (url.includes(gitee)) return url.replace(gitee, github);
  }
  return url;
}

export const GITHUB_REPOS = {
  sillytavern: "https://github.com/SillyTavern/SillyTavern",
  launcher: "https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux",
} as const;

/** 内置镜像源（按推荐顺序）。 */
export const MIRROR_LIST: [key: string, display: string][] = [
  ["github", "github.com (官方源)"],
  ["ghproxy", "gh-proxy.org"],
  ["ghllkk", "gh.llkk.cc"],
];

const MIRROR_TEMPLATES: Record<string, string> = {
  github: "https://github.com/{org}/{repo}",
  ghproxy: "https://gh-proxy.org/https://github.com/{org}/{repo}",
  ghllkk: "https://gh.llkk.cc/https://github.com/{org}/{repo}",
};

const RAW_MIRROR_TEMPLATES: Record<string, string> = {
  github: "https://raw.githubusercontent.com/{org}/{repo}",
  ghproxy: "https://gh-proxy.org/https://raw.githubusercontent.com/{org}/{repo}",
  ghllkk: "https://gh.llkk.cc/https://raw.githubusercontent.com/{org}/{repo}",
};

export const KEY_TO_DOMAIN: Record<string, string> = {
  github: "github.com",
  ghproxy: "gh-proxy.org",
  ghllkk: "gh.llkk.cc",
};

const DOMAIN_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_TO_DOMAIN).map(([k, v]) => [v, k]),
);

export const SUPPORTED_MIRRORS = MIRROR_LIST.map(([key]) => key);

export function normalizeMirror(mirror: string): string {
  if (mirror in MIRROR_TEMPLATES) return mirror;
  return DOMAIN_TO_KEY[mirror] ?? mirror;
}

export function getDisplayName(mirror: string): string {
  return KEY_TO_DOMAIN[mirror] ?? mirror;
}

export function buildGitUrl(org: string, repo: string, mirror = "github"): string {
  const key = normalizeMirror(mirror);
  if (key === "github") return `https://github.com/${org}/${repo}.git`;
  if (key in MIRROR_TEMPLATES) {
    return MIRROR_TEMPLATES[key].replace("{org}", org).replace("{repo}", repo) + ".git";
  }
  return `https://${key}/https://github.com/${org}/${repo}.git`;
}

export function buildRawUrl(org: string, repo: string, branch = "main", path = "", mirror = "github"): string {
  const key = normalizeMirror(mirror);
  if (key === "github") {
    return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${path}`;
  }
  if (key in RAW_MIRROR_TEMPLATES) {
    const base = RAW_MIRROR_TEMPLATES[key].replace("{org}", org).replace("{repo}", repo);
    return `${base}/${branch}/${path}`;
  }
  return `https://${key}/https://raw.githubusercontent.com/${org}/${repo}/${branch}/${path}`;
}

/** 配置 Git 全局 insteadOf 重写；返回是否成功。 */
export async function applyGitMirrorConfig(mirrorKey: string, log?: (line: string) => void): Promise<boolean> {
  const say = log ?? ((line: string) => process.stdout.write(line + "\n"));
  await run(["git", "config", "--global", "--unset-all", "url.https://github.com/.insteadof"]);
  if (mirrorKey !== "github") {
    const domain = KEY_TO_DOMAIN[mirrorKey] ?? mirrorKey;
    const mirrorUrl = `https://${domain}/https://github.com/`;
    const result = await run([
      "git", "config", "--global",
      `url.${mirrorUrl}.insteadof`, "https://github.com/",
    ]);
    if (!result.ok) {
      say(`配置Git全局镜像时出错: ${result.stderr.trim()}`);
      return false;
    }
    say(`Git全局镜像已配置: ${mirrorUrl} -> https://github.com/`);
  }
  return true;
}

/** 校验并设置镜像（写配置 + gitconfig）；返回结果对象，展示交给调用方。 */
export function validateMirrorInput(mirror: string): { ok: true; key: string } | { ok: false; message: string } {
  const trimmed = mirror.trim();
  if (!trimmed) return { ok: false, message: "镜像源不能为空" };
  const key = normalizeMirror(trimmed);
  if (!SUPPORTED_MIRRORS.includes(key)) {
    if (!/^[\w.-]+\.[a-zA-Z]{2,}$/.test(key.replace(/^https?:\/\//, ""))) {
      return { ok: false, message: `无效的镜像源: ${trimmed}（支持: ${SUPPORTED_MIRRORS.map(getDisplayName).join(", ")}）` };
    }
  }
  return { ok: true, key };
}

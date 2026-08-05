const API = "https://api.github.com";

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!trimmed) return null;

  let m = trimmed.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/);
  if (m) return { owner: m[1], repo: m[2] };

  m = trimmed.match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (m) return { owner: m[1], repo: m[2] };

  return null;
}

async function api<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub rate limit reached (60/hr for public repos). Add a token.");
  }
  if (res.status === 404) {
    throw new Error("Repository not found or it is private.");
  }
  if (!res.ok) {
    throw new Error(`GitHub error: ${res.status}`);
  }

  return (await res.json()) as T;
}

interface BranchRes {
  name: string;
  commit: { sha: string };
}

interface CommitItem {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author: { login?: string; avatar_url?: string } | null;
  html_url: string;
}

export async function getRepoInfo(
  owner: string,
  repo: string,
  token?: string
): Promise<{ full_name: string; html_url: string; owner_avatar?: string }> {
  const info = await api<{ full_name: string; html_url: string; owner?: { avatar_url?: string } }>(
    `/repos/${owner}/${repo}`,
    token
  );
  return {
    full_name: info.full_name,
    html_url: info.html_url,
    owner_avatar: info.owner?.avatar_url,
  };
}

export async function getBranches(owner: string, repo: string, token?: string): Promise<BranchRes[]> {
  return api<BranchRes[]>(`/repos/${owner}/${repo}/branches?per_page=100`, token);
}

export async function getCommits(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<CommitItem[]> {
  return api<CommitItem[]>(
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=50`,
    token
  );
}

export interface RawCommit {
  sha: string;
  message: string;
  authorName: string;
  authorLogin?: string;
  avatarUrl?: string;
  date: string;
  htmlUrl: string;
}

export async function getBranchCommits(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<RawCommit[]> {
  const items = await getCommits(owner, repo, branch, token);
  return items.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0],
    authorName: c.commit.author.name,
    authorLogin: c.author?.login,
    avatarUrl: c.author?.avatar_url,
    date: c.commit.author.date,
    htmlUrl: c.html_url,
  }));
}

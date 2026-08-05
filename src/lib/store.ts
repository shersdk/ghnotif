import type { WatchedRepo } from "./types";

const KEY = "ghnotif.watched.v1";
const tokenKey = "ghnotif.token";

let cache: WatchedRepo[] | null = null;

export function loadRepos(): WatchedRepo[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as WatchedRepo[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function saveRepos(): void {
  localStorage.setItem(KEY, JSON.stringify(cache ?? []));
}

export function addRepo(repo: WatchedRepo): void {
  const repos = loadRepos();
  const existing = repos.find((r) => r.full_name.toLowerCase() === repo.full_name.toLowerCase());
  if (!existing) {
    repos.unshift(repo);
    cache = repos;
    saveRepos();
  }
}

export function updateRepo(repo: WatchedRepo): void {
  const repos = loadRepos();
  const idx = repos.findIndex((r) => r.id === repo.id);
  if (idx >= 0) {
    repos[idx] = repo;
    cache = repos;
    saveRepos();
  }
}

export function removeRepo(id: string): void {
  const repos = loadRepos().filter((r) => r.id !== id);
  cache = repos;
  saveRepos();
}

export function getToken(): string | undefined {
  return localStorage.getItem(tokenKey) || undefined;
}

export function setToken(token: string): void {
  if (token.trim()) localStorage.setItem(tokenKey, token.trim());
  else localStorage.removeItem(tokenKey);
}

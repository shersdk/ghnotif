import { invoke } from "@tauri-apps/api/core";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import {
  parseRepoInput,
  getRepoInfo,
  getBranches,
  getBranchCommits,
} from "./lib/api";
import {
  loadRepos,
  addRepo,
  updateRepo,
  removeRepo,
  getToken,
} from "./lib/store";
import type { Commit, WatchedRepo, PollResult, Status } from "./lib/types";

const POLL_MS = 60_000;

const feed = document.getElementById("feed") as HTMLElement;
const emptyState = document.getElementById("emptyState") as HTMLElement;
const addForm = document.getElementById("addForm") as HTMLFormElement;
const repoInput = document.getElementById("repoInput") as HTMLInputElement;
const addBtn = document.getElementById("addBtn") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLElement;
const statusText = document.getElementById("statusText") as HTMLElement;
const toasts = document.getElementById("toasts") as HTMLElement;

let repos: WatchedRepo[] = [];
let polling = false;
let pollCount = 0;

function log(line: string): void {
  const ts = new Date().toISOString();
  const entry = `${ts}  ${line}`;
  console.log(entry);
  invoke("append_log", { line: entry }).catch(() => {
    // logging is best-effort
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function setStatus(status: Status, text: string): void {
  statusDot.className = `status-dot ${status === "idle" ? "" : status}`;
  statusText.textContent = text;
}

function render(): void {
  if (repos.length === 0) {
    emptyState.style.display = "flex";
    feed.querySelectorAll(".repo-block").forEach((el) => el.remove());
    return;
  }
  emptyState.style.display = "none";

  feed
    .querySelectorAll(".repo-block")
    .forEach((el) => el.remove());

  repos.forEach((repo) => {
    const block = document.createElement("div");
    block.className = "repo-block";
    const header = document.createElement("div");
    header.className = "repo-header glass";
    header.innerHTML = `
      <span class="repo-name">${esc(repo.full_name)}</span>
      <button class="remove-btn" data-id="${esc(repo.id)}" title="Stop watching">✕</button>
    `;
    const commits = document.createElement("div");
    commits.className = "repo-commits";
    commits.dataset.repo = repo.id;
    block.appendChild(header);
    block.appendChild(commits);
    feed.appendChild(block);
  });

  feed.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      removeRepo(id);
      repos = loadRepos();
      render();
    });
  });
}

function addCommitCard(repo: WatchedRepo, commit: Commit): void {
  const container = feed.querySelector<HTMLElement>(`.repo-commits[data-repo="${repo.id}"]`);
  if (!container) return;

  const avatar = commit.author.avatar_url
    ? `background-image:url('${commit.author.avatar_url}')`
    : "";
  const hasImg = !!commit.author.avatar_url;

  const card = document.createElement("article");
  card.className = "commit is-new";
  card.innerHTML = `
    <div class="avatar ${hasImg ? "" : "fallback"}" style="${avatar}">${hasImg ? "" : esc(initials(commit.author.name))}</div>
    <div class="commit-body">
      <div class="commit-msg">${esc(commit.message)}</div>
      <div class="commit-meta">
        <span class="branch-badge">${esc(commit.branch)}</span>
        <span class="author">${esc(commit.author.name)}</span>
        <span class="repo-tag">${esc(repo.full_name)}</span>
        <span>${timeAgo(commit.date)}</span>
        <span class="sha">${shortSha(commit.sha)}</span>
      </div>
    </div>
  `;

  container.prepend(card);
  requestAnimationFrame(() => card.classList.add("flash"));
}

function addToast(title: string, body: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-title"><span class="dot"></span>${esc(title)}</div>
    <div class="toast-body">${esc(body)}</div>
  `;
  toasts.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

async function ensureNotifPermission(): Promise<void> {
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch {
    // Notifications unavailable (e.g. plain browser) — in-app toasts still work.
  }
}

async function notifyCommit(repo: WatchedRepo, commit: Commit): Promise<void> {
  const title = `${repo.full_name} · ${commit.branch}`;
  const body = `${commit.author.name}: ${commit.message}`;
  addToast(title, body);
  try {
    sendNotification({ title, body });
  } catch {
    // ignore
  }
}

function stripAvatarQuery(url?: string): string | undefined {
  if (!url) return undefined;
  const base = url.split("?v=")[0];
  return base + "?s=96";
}

async function watchCommits(repo: WatchedRepo, token?: string): Promise<Commit[]> {
  const [owner, name] = repo.full_name.split("/");
  const newCommits: Commit[] = [];
  const nextBranches: Record<string, string> = { ...repo.branches };

  const branches = await getBranches(owner, name, token);
  for (const branch of branches) {
    const raws = await getBranchCommits(owner, name, branch.name, token);
    if (raws.length === 0) continue;

    const known = repo.branches[branch.name];
    const isFirst = !known;

    if (isFirst) {
      nextBranches[branch.name] = raws[0].sha;
      log(`baseline ${repo.full_name}#${branch.name} = ${raws[0].sha.slice(0, 7)} (${raws.length} commits, no notify)`);
      continue;
    }

    const knownIdx = raws.findIndex((c) => c.sha === known);
    const cutoff = knownIdx === -1 ? raws.length : knownIdx;
    nextBranches[branch.name] = raws[0].sha;

    log(`poll ${repo.full_name}#${branch.name}: head=${raws[0].sha.slice(0, 7)} known=${known.slice(0, 7)} atIdx=${knownIdx} -> new=${cutoff}`);

    for (let i = 0; i < cutoff; i++) {
      const c = raws[i];
      newCommits.push({
        sha: c.sha,
        message: c.message,
        author: {
          name: c.authorName,
          email: "",
          login: c.authorLogin,
          avatar_url: stripAvatarQuery(c.avatarUrl),
        },
        date: c.date,
        branch: branch.name,
        html_url: c.htmlUrl,
      });
    }
  }

  const updated: WatchedRepo = { ...repo, branches: nextBranches };
  updateRepo(updated);

  return newCommits;
}

async function poll(): Promise<void> {
  if (polling || repos.length === 0) return;
  polling = true;
  pollCount += 1;
  setStatus("polling", "checking for new commits…");
  const token = getToken();

  try {
    const results: PollResult[] = [];
    for (const repo of repos) {
      try {
        const newCommits = await watchCommits(repo, token);
        results.push({ repo, newCommits });
      } catch (err) {
        console.error(err);
        log(`ERROR ${repo.full_name}: ${(err as Error).message}`);
        setStatus("error", `${repo.full_name}: ${(err as Error).message}`);
      }
    }

    for (const { repo, newCommits } of results) {
      for (const commit of newCommits) {
        addCommitCard(repo, commit);
        log(`NEW ${repo.full_name}#${commit.branch} ${commit.sha.slice(0, 7)} ${commit.author.name}: ${commit.message}`);
        await notifyCommit(repo, commit);
      }
    }

    setStatus("online", `watching ${repos.length} repo${repos.length === 1 ? "" : "s"} · check #${pollCount}`);
  } finally {
    polling = false;
  }
}

async function onAddRepo(e: Event): Promise<void> {
  e.preventDefault();
  const parsed = parseRepoInput(repoInput.value);
  if (!parsed) {
    setStatus("error", "Enter a valid repo, e.g. owner/repo");
    return;
  }

  addBtn.disabled = true;
  addBtn.textContent = "…";
  setStatus("polling", `adding ${parsed.owner}/${parsed.repo}…`);

  try {
    const token = getToken();
    const info = await getRepoInfo(parsed.owner, parsed.repo, token);
    const repo: WatchedRepo = {
      id: crypto.randomUUID(),
      full_name: info.full_name,
      html_url: info.html_url,
      owner_avatar: stripAvatarQuery(info.owner_avatar),
      branches: {},
    };
    addRepo(repo);
    repos = loadRepos();
    repoInput.value = "";
    render();
    const newCommits = await watchCommits(repo, token);
    for (const c of newCommits) addCommitCard(repo, c);
    setStatus("online", `watching ${info.full_name}`);
  } catch (err) {
    setStatus("error", (err as Error).message);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = "Watch";
  }
}

function start(): void {
  ensureNotifPermission();
  repos = loadRepos();
  render();

  void poll();
  setInterval(() => void poll(), POLL_MS);
}

addForm.addEventListener("submit", onAddRepo);

start();

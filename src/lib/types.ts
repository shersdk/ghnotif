export interface CommitAuthor {
  name: string;
  email: string;
  login?: string;
  avatar_url?: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: CommitAuthor;
  date: string;
  branch: string;
  html_url: string;
}

export interface WatchedRepo {
  id: string;
  full_name: string;
  html_url: string;
  owner_avatar?: string;
  branches: Record<string, string>;
}

export type Status = "idle" | "online" | "polling" | "error";

export interface PollResult {
  repo: WatchedRepo;
  newCommits: Commit[];
}

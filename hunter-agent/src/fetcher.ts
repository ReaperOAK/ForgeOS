import { Config } from './config.js';
import type { GitHubIssue, GitHubComment } from './types.js';

export class IssueFetcher {
  private headers: Record<string, string>;
  private baseUrl = 'https://api.github.com/repos/Expensify/App';

  constructor(private config: Config) {
    this.headers = {
      Authorization: `token ${config.githubToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'hunter-agent/1.0',
    };
  }

  /** Fetch the latest Help Wanted issue (just one) */
  async fetchLatest(): Promise<GitHubIssue | null> {
    const params = new URLSearchParams({
      labels: 'Help Wanted',
      state: 'open',
      sort: 'created',
      direction: 'desc',
      per_page: '1',
    });

    const res = await fetch(`${this.baseUrl}/issues?${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const issues = (await res.json()) as GitHubIssue[];
    return issues[0] ?? null;
  }

  /** Fetch a specific issue by number */
  async fetchByNumber(issueNumber: number): Promise<GitHubIssue> {
    const res = await fetch(`${this.baseUrl}/issues/${issueNumber}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error fetching #${issueNumber}: ${res.status}`);
    return res.json() as Promise<GitHubIssue>;
  }

  /** Fetch all comments for an issue */
  async fetchComments(issueNumber: number): Promise<GitHubComment[]> {
    const res = await fetch(`${this.baseUrl}/issues/${issueNumber}/comments?per_page=100`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitHub API error fetching comments for #${issueNumber}: ${res.status}`);
    return res.json() as Promise<GitHubComment[]>;
  }
}
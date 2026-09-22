export interface GitHubRepoDetails {
    owner: string;
    name: string;
    defaultBranch: string;
    sizeKb: number;
}

export class GitHubService {
    private static parseUrl(url: string): { owner: string; repo: string } {
        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!match) {
            throw new Error('Invalid GitHub repository URL format');
        }
        const [, owner, repo] = match;
        return { owner, repo: repo.replace(/\.git$/, '') };
    }

    static async getRepoDetails(githubUrl: string): Promise<GitHubRepoDetails> {
        const { owner, repo } = this.parseUrl(githubUrl);
        const token = process.env.GITHUB_TOKEN;

        const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'github-knowledge-assistant',
        };

        if (token) {
            headers.Authorization = `token ${token}`;
        }

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers,
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Repository not found or private');
            }
            if (response.status === 403) {
                throw new Error('GitHub API rate limit exceeded');
            }
            throw new Error(`Failed to fetch repo: ${response.statusText}`);
        }

        const data = await response.json();

        // Cap repo size at 50MB (51200 KB) for MVP
        if (data.size > 51200) {
            throw new Error('Repository exceeds 50MB limit for MVP processing');
        }

        return {
            owner: data.owner.login,
            name: data.name,
            defaultBranch: data.default_branch,
            sizeKb: data.size,
        };
    }
}
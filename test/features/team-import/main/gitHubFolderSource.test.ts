import { parseGitHubFolderUrl } from '@features/team-import/main/infrastructure/GitHubFolderSource';
import { describe, expect, it } from 'vitest';

describe('parseGitHubFolderUrl', () => {
  it('reads owner, repo, ref, and subfolder from a tree URL', () => {
    expect(
      parseGitHubFolderUrl(
        'https://github.com/mengbingrock/attymate/tree/9831c592bf46819d4f4d68024cd18a3559eeca19/companies/california-litigation-legal-team'
      )
    ).toEqual({
      owner: 'mengbingrock',
      repo: 'attymate',
      ref: '9831c592bf46819d4f4d68024cd18a3559eeca19',
      subPath: 'companies/california-litigation-legal-team',
    });
  });

  it('handles a branch ref and a blob URL', () => {
    expect(parseGitHubFolderUrl('https://github.com/acme/team/tree/main/companies')).toMatchObject({
      ref: 'main',
      subPath: 'companies',
    });
    expect(
      parseGitHubFolderUrl('https://github.com/acme/team/blob/main/COMPANY.md')
    ).toMatchObject({ ref: 'main', subPath: 'COMPANY.md' });
  });

  it('treats a bare repository URL as its default branch root', () => {
    expect(parseGitHubFolderUrl('https://github.com/acme/team')).toEqual({
      owner: 'acme',
      repo: 'team',
      ref: 'HEAD',
      subPath: '',
    });
  });

  it('ignores non-repository GitHub URLs and other hosts', () => {
    expect(parseGitHubFolderUrl('https://github.com/acme/team/issues/12')).toBeNull();
    expect(parseGitHubFolderUrl('https://example.com/acme/team/tree/main')).toBeNull();
    expect(parseGitHubFolderUrl('https://raw.githubusercontent.com/acme/team/main/a.md')).toBeNull();
    expect(parseGitHubFolderUrl('not a url')).toBeNull();
  });
});

import { expect, it } from 'vitest';
import { findLocalLink, repositoryIdentity } from './repositoryLinks';
it('matches repository identity across case, HTTPS and SSH remotes', () => {
  expect(repositoryIdentity('git@github.com:Owner/Repo.git')).toBe('owner/repo');
  expect(repositoryIdentity('https://github.com/Owner/Repo.git')).toBe('owner/repo');
  const link = { id: 'a', repositoryId: 0, owner: 'owner', name: 'repo', localPath: 'C:/repo', lastOpenedAt: '' };
  expect(findLocalLink({ id: 5, full_name: 'Owner/Repo' }, [link])).toBe(link);
  expect(findLocalLink({ id: 5, full_name: 'Other/Repo' }, [link])).toBeUndefined();
});
it('prefers a local folder whose status could be read when a repository has several', () => {
  const copy = (id: string) => ({
    id,
    repositoryId: 5,
    owner: 'owner',
    name: 'repo',
    localPath: `/${id}`,
    lastOpenedAt: '',
  });
  const [broken, works] = [copy('broken'), copy('works')];
  expect(findLocalLink({ id: 5, full_name: 'Owner/Repo' }, [broken, works])).toBe(broken);
  expect(findLocalLink({ id: 5, full_name: 'Owner/Repo' }, [broken, works], { broken: true })).toBe(works);
  expect(findLocalLink({ id: 5, full_name: 'Owner/Repo' }, [broken], { broken: true })).toBe(broken);
});

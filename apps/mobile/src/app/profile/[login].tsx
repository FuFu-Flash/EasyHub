import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { type Contributions, type GitHubRepo, type GitHubUser } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function Profile() {
  const { login } = useLocalSearchParams<{ login: string }>();
  const { client, ready } = useSession();
  const { t } = usePreferences();
  const [profile, setProfile] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [contributions, setContributions] = useState<Contributions | null>(null);
  const [selectedDay, setSelectedDay] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    if (!client || !login) return;
    let active = true;
    setBusy(true);
    const now = new Date();
    const from = new Date(now.getFullYear(), 0, 1).toISOString();
    void client.profile(login).then(async (person) => {
      const [projects, activity] = await Promise.allSettled([
        client.topStarredRepos(login), client.contributions(login, from, now.toISOString()),
      ]);
      if (active) {
        setProfile(person);
        setRepos(projects.status === 'fulfilled' ? projects.value : []);
        setContributions(activity.status === 'fulfilled' ? activity.value : null);
        setError('');
      }
    }).catch(() => { if (active) setError(t('用户资料暂时无法加载，请稍后重试。', 'Could not load this profile. Please try again later.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, login, t]);
  useFocusEffect(refresh);
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('用户主页', 'User profile')} subtitle={t('登录后查看 GitHub 用户资料。', 'Sign in to view GitHub profiles.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh}>
    <Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 20 }}>← {t('返回发现', 'Back to Discover')}</Text>
    {busy && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {profile && <>
      <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}><Image source={{ uri: profile.avatar_url }} style={{ width: 72, height: 72, borderRadius: 21 }} /><View style={{ flex: 1 }}><Text style={{ fontSize: 23, fontWeight: '800', color: palette.ink }}>{profile.name || profile.login}</Text><Text style={{ color: palette.muted }}>@{profile.login}</Text></View></View>
        {!!profile.bio && <Text style={{ color: palette.ink, lineHeight: 21, marginTop: 15 }}>{profile.bio}</Text>}
        <Text style={{ color: palette.muted, marginTop: 12 }}>{profile.public_repos ?? 0} {t('个公开项目', 'public projects')} · {profile.followers ?? 0} {t('位关注者', 'followers')}</Text>
      </Card>
      {contributions && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('今年的贡献', 'Contributions this year')}</Text><Text style={{ color: palette.muted, marginVertical: 8 }}>{contributions.total} {t('次公开活动', 'public activities')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{ flexDirection: 'row', gap: 3, paddingVertical: 8 }}>{contributions.weeks.map((week, index) => <View key={index} style={{ gap: 3 }}>{week.contributionDays.map((day) => <Pressable key={day.date} accessibilityLabel={`${day.date}：${day.contributionCount} ${t('次贡献', 'contributions')}`} onPress={() => setSelectedDay(`${day.date} · ${day.contributionCount} ${t('次贡献', 'contributions')}`)} style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: day.contributionCount ? day.color : '#ebf0f6' }} />)}</View>)}</View></ScrollView>
        {!!selectedDay && <Text style={{ color: palette.blue, marginTop: 6 }}>{selectedDay}</Text>}
      </Card>}
      <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 19, marginTop: 12, marginBottom: 11 }}>{t('受关注的项目', 'Popular projects')}</Text>
      {repos.length ? repos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{repo.name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{repo.description || t('还没有项目简介。', 'No description yet.')}</Text><Text style={{ color: palette.blue, marginTop: 9 }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text></Card></Pressable>) : <Card><Text style={{ color: palette.muted }}>{t('没有可展示的公开项目。', 'No public projects to show.')}</Text></Card>}
    </>}
  </Page>;
}

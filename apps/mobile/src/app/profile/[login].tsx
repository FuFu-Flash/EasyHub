import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { type Contributions, type GitHubRepo, type GitHubUser } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

const contributionLabels = { 更新: 'Commits', 问题: 'Issues', 合并请求: 'Pull requests' } as const;

export default function Profile() {
  const { login } = useLocalSearchParams<{ login: string }>();
  return <ProfileDetails key={login} login={login} />;
}

function ProfileDetails({ login }: { login: string }) {
  const { client, ready } = useSession();
  const { t } = usePreferences();
  const [profile, setProfile] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [contributions, setContributions] = useState<Contributions | null>(null);
  const [selectedDay, setSelectedDay] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [dayActivity, setDayActivity] = useState<Contributions | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const focused = useRef(false);
  const request = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const dayRequest = useRef<AbortController | null>(null);
  const dayTask = useRef<Promise<void> | null>(null);
  const loadProfile = useCallback(() => {
    if (!client || !login) return Promise.resolve();
    if (readTask.current) return readTask.current;
    const controller = new AbortController(); request.current = controller;
    const active = () => !controller.signal.aborted && request.current === controller;
    setBusy(true); setError(''); setActivityError('');
    const now = new Date();
    const from = `${year}-01-01T00:00:00.000Z`;
    const to = year === now.getFullYear() ? now.toISOString() : `${year}-12-31T23:59:59.999Z`;
    const task = client.profile(login, controller.signal).then(async (person) => {
      if (!active()) return;
      const [projects, activity] = await Promise.allSettled([
        client.topStarredRepos(login, controller.signal), client.contributions(login, from, to, controller.signal),
      ]);
      if (active()) {
        setProfile(person);
        if (projects.status === 'fulfilled') setRepos(projects.value);
        else setError(t('受关注的项目加载失败，请下拉重试。', 'Could not load popular projects. Pull down to retry.'));
        if (activity.status === 'fulfilled') setContributions(activity.value);
        if (activity.status === 'rejected') setActivityError(t('贡献记录加载失败，请下拉重试。', 'Could not load contributions. Pull down to retry.'));
      }
    }).catch(() => { if (active()) setError(t('用户资料暂时无法加载，请稍后重试。', 'Could not load this profile. Please try again later.')); })
      .finally(() => {
        if (active()) setBusy(false);
        if (readTask.current === task) readTask.current = null;
      });
    readTask.current = task;
    return task;
  }, [client, login, t, year]);
  const loadDay = useCallback(() => {
    if (!client || !focused.current) return Promise.resolve();
    if (!selectedDay) { setDayBusy(false); return Promise.resolve(); }
    if (dayTask.current) return dayTask.current;
    const controller = new AbortController(); dayRequest.current = controller;
    const active = () => !controller.signal.aborted && dayRequest.current === controller;
    setDayBusy(true); setActivityError('');
    const task = client.contributions(login, `${selectedDay}T00:00:00.000Z`, `${selectedDay}T23:59:59.999Z`, controller.signal)
      .then((value) => { if (active()) setDayActivity(value); })
      .catch(() => { if (active()) setActivityError(t('当天活动加载失败，请重新选择日期。', 'Could not load this day. Select it again to retry.')); })
      .finally(() => {
        if (active()) setDayBusy(false);
        if (dayTask.current === task) dayTask.current = null;
      });
    dayTask.current = task;
    return task;
  }, [client, selectedDay, login, t]);
  const dayLoader = useRef(loadDay);
  useEffect(() => { dayLoader.current = loadDay; }, [loadDay]);
  const { refresh, refreshing } = usePullRefresh([loadProfile, loadDay]);
  useFocusEffect(useCallback(() => {
    focused.current = true; void loadProfile(); void dayLoader.current();
    return () => {
      focused.current = false;
      request.current?.abort(); request.current = null; readTask.current = null;
      dayRequest.current?.abort(); dayRequest.current = null; dayTask.current = null;
    };
  }, [loadProfile]));
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadDay(); });
    return () => { active = false; dayRequest.current?.abort(); dayRequest.current = null; dayTask.current = null; };
  }, [loadDay]);
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('用户主页', 'User profile')} subtitle={t('登录后查看 GitHub 用户资料。', 'Sign in to view GitHub profiles.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回发现', 'Back to Discover')} marginBottom={20} />
    {busy && !profile && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {profile && <>
      <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}><Image source={{ uri: profile.avatar_url }} style={{ width: 72, height: 72, borderRadius: 21 }} /><View style={{ flex: 1 }}><Text style={{ fontSize: 23, fontWeight: '800', color: palette.ink }}>{profile.name || profile.login}</Text><Text style={{ color: palette.muted }}>@{profile.login}</Text></View></View>
        {!!profile.bio && <Text style={{ color: palette.ink, lineHeight: 21, marginTop: 15 }}>{profile.bio}</Text>}
        <Text style={{ color: palette.muted, marginTop: 12 }}>{profile.public_repos ?? 0} {t('个公开项目', 'public projects')} · {profile.followers ?? 0} {t('位关注者', 'followers')} · {t('关注', 'Following')} {profile.following ?? 0}</Text>
        {!!profile.location && <Text style={{ color: palette.muted, marginTop: 6 }}>{profile.location}</Text>}
      </Card>
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{year} {t('年贡献', 'contributions')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 7 }}>{[...new Set([new Date().getFullYear(), year, ...(contributions?.years ?? [])])].sort((a, b) => b - a).map((item) => <Pressable key={item} onPress={() => { if (year !== item) { setSelectedDay(''); setDayActivity(null); setContributions(null); setYear(item); } }} accessibilityRole="button" accessibilityState={{ selected: item === year }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: item === year ? '#e7f0ff' : palette.background }}><Text style={{ color: item === year ? palette.blue : palette.muted, fontWeight: '700' }}>{item}</Text></Pressable>)}</ScrollView>
      {contributions && <><Text style={{ color: palette.muted, marginVertical: 8 }}>{contributions.total} {t('次贡献', 'contributions')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{ flexDirection: 'row', gap: 3, paddingVertical: 8 }}>{contributions.weeks.map((week, index) => <View key={index} style={{ gap: 3 }}>{week.contributionDays.map((day) => <Pressable key={day.date} accessibilityLabel={`${day.date}：${day.contributionCount} ${t('次贡献', 'contributions')}`} onPress={() => { if (selectedDay !== day.date) { setDayActivity(null); setSelectedDay(day.date); } }} style={{ width: 11, height: 11, borderRadius: 2, borderWidth: selectedDay === day.date ? 1 : 0, borderColor: palette.blue, backgroundColor: day.contributionCount ? day.color : '#ebf0f6' }} />)}</View>)}</View></ScrollView>
      </>}
      {!!activityError && <Text style={{ color: '#bf3947', marginTop: 8 }}>{activityError}</Text>}
      </Card>
      {contributions && <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{selectedDay ? `${selectedDay} ${t('的活动', 'activity')}` : `${year} ${t('年参与的项目', 'projects')}`}</Text>
        {!!selectedDay && <Text onPress={() => setSelectedDay('')} style={{ color: palette.blue, marginTop: 8 }}>{t('查看全年', 'View full year')}</Text>}
        {dayBusy && !!selectedDay && !dayActivity ? <Loading /> : (selectedDay ? dayActivity : contributions)?.repositories.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).map((item) => <Pressable key={`${item.fullName}:${item.kind}`} disabled={item.isPrivate} onPress={() => { const [owner, repo] = item.fullName.split('/'); if (owner && repo) router.push({ pathname: '/project/[owner]/[repo]', params: { owner, repo, mode: 'public' } }); }} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{item.isPrivate ? t('私有项目', 'Private project') : item.fullName}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{t(item.kind, contributionLabels[item.kind])} · {item.count}{item.isPrivate ? ` · ${t('不可公开浏览', 'Unavailable for public browsing')}` : ''}</Text></Pressable>)}
        {!dayBusy && !(selectedDay ? dayActivity : contributions)?.repositories.some((item) => item.count > 0) && <Text style={{ color: palette.muted, marginTop: 12 }}>{t('这段时间没有可展示的项目活动。', 'No project activity to show in this period.')}</Text>}
      </Card>}
      <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 19, marginTop: 12, marginBottom: 11 }}>{t('受关注的项目', 'Popular projects')}</Text>
      {repos.length ? repos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{repo.name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{repo.description || t('还没有项目简介。', 'No description yet.')}</Text><Text style={{ color: palette.blue, marginTop: 9 }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text></Card></Pressable>) : <Card><Text style={{ color: palette.muted }}>{t('没有可展示的公开项目。', 'No public projects to show.')}</Text></Card>}
    </>}
  </Page>;
}

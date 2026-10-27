import { useSessionReadFocusEffect } from '@/features/auth/useSessionReadFocusEffect';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { type Contributions, type GitHubRepo, type GitHubUser } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { usePullRefresh } from '@/features/github/usePullRefresh';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { themed } from '@/features/theme/theme';

const contributionLabels = { 更新: "login.commits", 问题: "issues.issues", 合并请求: "login.pullRequests" } as const;

export default function Profile() {
  const { login } = useLocalSearchParams<{ login: string }>();
  return <ProfileDetails key={login} login={login} />;
}

function ProfileDetails({ login }: { login: string }) {
  const { client, ready } = useSession();
  const t = useTranslation();
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
        else setError(t("login.couldNotLoadPopularProjectsPullDownToRetry"));
        if (activity.status === 'fulfilled') setContributions(activity.value);
        if (activity.status === 'rejected') setActivityError(t("login.couldNotLoadContributionsPullDownToRetry"));
      }
    }).catch(() => { if (active()) setError(t("login.couldNotLoadThisProfilePleaseTryAgainLater")); })
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
      .catch(() => { if (active()) setActivityError(t("login.couldNotLoadThisDaySelectItAgainToRetry")); })
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
  useSessionReadFocusEffect(useCallback(() => {
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
  if (!client) return <Page><Heading title={t("login.userProfile")} subtitle={t("login.signInToViewGitHubProfiles")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t("login.backToDiscover")} marginBottom={20} />
    {busy && !profile && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {profile && <>
      <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}><Image source={{ uri: profile.avatar_url }} style={{ width: 72, height: 72, borderRadius: 21 }} /><View style={{ flex: 1 }}><Text style={{ fontSize: 23, fontWeight: '800', color: palette.ink }}>{profile.name || profile.login}</Text><Text style={{ color: palette.muted }}>@{profile.login}</Text></View></View>
        {!!profile.bio && <Text style={{ color: palette.ink, lineHeight: 21, marginTop: 15 }}>{profile.bio}</Text>}
        <Text style={{ color: palette.muted, marginTop: 12 }}>{t("profile.publicProjectCount", { count: profile.public_repos ?? 0 })} · {t("profile.followerCount", { count: profile.followers ?? 0 })} · {t("profile.followingCount", { count: profile.following ?? 0 })}</Text>
        {!!profile.location && <Text style={{ color: palette.muted, marginTop: 6 }}>{profile.location}</Text>}
      </Card>
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("profile.yearContributions", { year })}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 7 }}>{[...new Set([new Date().getFullYear(), year, ...(contributions?.years ?? [])])].sort((a, b) => b - a).map((item) => <Pressable key={item} onPress={() => { if (year !== item) { setSelectedDay(''); setDayActivity(null); setContributions(null); setYear(item); } }} accessibilityRole="button" accessibilityState={{ selected: item === year }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: item === year ? themed('#e7f0ff') : palette.background }}><Text style={{ color: item === year ? palette.blue : palette.muted, fontWeight: '700' }}>{item}</Text></Pressable>)}</ScrollView>
      {contributions && <><Text style={{ color: palette.muted, marginVertical: 8 }}>{t("profile.contributionCount", { count: contributions.total })}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{ flexDirection: 'row', gap: 3, paddingVertical: 8 }}>{contributions.weeks.map((week, index) => <View key={index} style={{ gap: 3 }}>{week.contributionDays.map((day) => <Pressable key={day.date} accessibilityLabel={t("profile.dayContributionCount", { date: day.date, count: day.contributionCount })} onPress={() => { if (selectedDay !== day.date) { setDayActivity(null); setSelectedDay(day.date); } }} style={{ width: 11, height: 11, borderRadius: 2, borderWidth: selectedDay === day.date ? 1 : 0, borderColor: palette.blue, backgroundColor: day.contributionCount ? day.color : themed('#ebf0f6') }} />)}</View>)}</View></ScrollView>
      </>}
      {!!activityError && <Text style={{ color: themed('#bf3947'), marginTop: 8 }}>{activityError}</Text>}
      </Card>
      {contributions && <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{selectedDay ? t("profile.dayActivity", { date: selectedDay }) : t("profile.yearProjects", { year })}</Text>
        {!!selectedDay && <Text onPress={() => setSelectedDay('')} style={{ color: palette.blue, marginTop: 8 }}>{t("login.viewFullYear")}</Text>}
        {dayBusy && !!selectedDay && !dayActivity ? <Loading /> : (selectedDay ? dayActivity : contributions)?.repositories.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).map((item) => <Pressable key={`${item.fullName}:${item.kind}`} disabled={item.isPrivate} onPress={() => { const [owner, repo] = item.fullName.split('/'); if (owner && repo) router.push({ pathname: '/project/[owner]/[repo]', params: { owner, repo, mode: 'public' } }); }} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{item.isPrivate ? t("login.privateProject") : item.fullName}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{t(contributionLabels[item.kind])} · {item.count}{item.isPrivate ? ` · ${t("login.unavailableForPublicBrowsing")}` : ''}</Text></Pressable>)}
        {!dayBusy && !(selectedDay ? dayActivity : contributions)?.repositories.some((item) => item.count > 0) && <Text style={{ color: palette.muted, marginTop: 12 }}>{t("login.noProjectActivityToShowInThisPeriod")}</Text>}
      </Card>}
      <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 19, marginTop: 12, marginBottom: 11 }}>{t("login.popularProjects")}</Text>
      {repos.length ? repos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{repo.name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{repo.description || t("discover.noDescriptionYet")}</Text><Text style={{ color: palette.blue, marginTop: 9 }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text></Card></Pressable>) : <Card><Text style={{ color: palette.muted }}>{t("discover.noPublicProjectsToShow")}</Text></Card>}
    </>}
  </Page>;
}

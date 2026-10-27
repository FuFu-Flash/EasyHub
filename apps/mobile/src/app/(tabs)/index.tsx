import { useSessionReadFocusEffect } from '@/features/auth/useSessionReadFocusEffect';
import { getTranslator } from '@/features/localization';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useRef, useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';
import { SessionConnectionNotice } from '@/components/SessionConnectionNotice';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, DirectionLabel, ErrorText, Loading, Page, palette } from '@/components/elements';
import { loadAllRepos } from '@/features/github/data';
import { loadOpenIssues } from '@/features/github/openIssues';
import { EarthIcon } from '@/components/EarthIcon';
import { useActivityNotices } from '@/features/github/useActivityNotices';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { HOME_TASK_PREVIEW, homeTaskGroups, type HomeTaskGroup } from '@/features/github/homeTasks';
import { themed, onAccent, themedStyles, scrim } from '@/features/theme/theme';

const appIcon = require('../../../assets/images/icon.png');
const minecraftIcon = require('../../../assets/images/minecraft-grass-block.png');

function BellIcon() {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={themed(themed('#60718b'))} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4" />
  </Svg>;
}

function ProjectIcon({ repo }: { repo: GitHubRepo }) {
  const lower = repo.name.toLowerCase();
  if (lower.includes('minecraft')) return <Image source={minecraftIcon} style={styles.projectIcon} resizeMode="cover" />;
  if (lower === 'easyhub') return <Image source={appIcon} style={styles.projectIcon} resizeMode="cover" />;
  if (/(site|website|webpage|网站|主页)/iu.test(lower)) return <View style={[styles.projectIcon, styles.iconGlobe]}><EarthIcon size={28} color={themed(themed('#3159d7'))} /></View>;
  return <View style={[styles.projectIcon, styles.iconFallback]}><Text style={styles.iconLetter}>{repo.name.slice(0, 1).toUpperCase()}</Text></View>;
}

function relativeTime(value: string, language: 'zh' | 'en'): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return getTranslator(language)("home.justNow");
  if (minutes < 60) return getTranslator(language)("home.minAgo", { p0: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return getTranslator(language)("home.hrAgo", { p0: hours });
  const days = Math.floor(hours / 24);
  return getTranslator(language)("home.daysAgo", { p0: days });
}

function HomeProject({ repo, issueCount }: { repo: GitHubRepo; issueCount: number }) {
  const { language } = usePreferences();
  const t = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.15;
  const open = () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } });
  const showMore = () => Alert.alert(repo.name, undefined, [
    { text: t("home.openProject"), onPress: open },
    { text: t("home.viewIssues"), onPress: () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'issues' } }) },
    { text: t("home.history"), onPress: () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'history' } }) },
    { text: t("AiReviewSettings.cancel"), style: 'cancel' },
  ]);
  return <View style={[styles.projectRow, compact && styles.projectRowStacked]}>
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={t("home.openNamedProject", { name: repo.name })} style={[styles.projectBody, compact && styles.projectBodyStacked]}>
      <ProjectIcon repo={repo} />
      <View style={styles.projectCopy}>
        <Text style={styles.projectName} numberOfLines={compact ? 2 : 1}>{repo.name}</Text>
        <Text style={styles.projectDescription} numberOfLines={compact ? 2 : 1}>{repo.description || t("elements.noDescriptionYet")}</Text>
        <View style={styles.projectStatus}><View style={styles.savedStatus}><View style={styles.savedDot} /><Text style={styles.savedText}>{t("home.saved")}</Text></View><Text style={styles.projectTime}>· {relativeTime(repo.updated_at, language)}{compact ? '' : ` · ${t("home.issueCount", { count: issueCount })}`}</Text></View>
      </View>
    </Pressable>
    <View style={[styles.projectActions, compact && styles.projectActionsStacked]}>
      <Pressable onPress={showMore} accessibilityRole="button" accessibilityLabel={t("home.moreActions")} style={styles.moreButton}><Text style={styles.moreText}>⋮</Text></Pressable>
    </View>
  </View>;
}

function HomeTaskRow({ group }: { group: HomeTaskGroup }) {
  const t = useTranslation();
  const { repo, issues, pulls } = group;
  const go = (section: 'issues' | 'pulls') => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section } });
  const actions = [
    ...(issues > 0 ? [{ section: 'issues' as const, summary: t("home.attentionOpenIssues", { count: issues }), action: t("home.viewIssues") }] : []),
    ...(pulls > 0 ? [{ section: 'pulls' as const, summary: t("home.attentionPullRequests", { count: pulls }), action: t("home.reviewPullRequests") }] : []),
  ];
  return <View style={styles.taskRow}>
    <View style={styles.taskHeader}><ProjectIcon repo={repo} /><Text style={[styles.projectName, { flex: 1 }]} numberOfLines={2}>{repo.name}</Text></View>
    {actions.map((item) => <View key={item.section} style={styles.taskLine}>
      <Text style={styles.taskSummary}>{item.summary}</Text>
      <Pressable onPress={() => go(item.section)} accessibilityRole="button" accessibilityLabel={t("home.taskAction", { action: item.action, name: repo.name })} style={styles.openButton}><Text style={styles.openText}>{item.action}</Text></Pressable>
    </View>)}
  </View>;
}

export default function Home() {
  const { ready, user, client, recovery } = useSession();
  const t = useTranslation();
  const { width, height, fontScale } = useWindowDimensions();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoIssueCounts, setRepoIssueCounts] = useState<Record<number, number>>({});
  const [activityCounts, setActivityCounts] = useState<Record<number, GitHubActivityCount>>({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const notices = repos.flatMap((repo) => [
    ...(activityCounts[repo.id]?.issues ? [{ id: `issues-${repo.id}`, revision: `${activityCounts[repo.id].issues}:${activityCounts[repo.id].closedIssues}`, repo, activity: 'issues' as const, title: t("home.openIssueNotice", { name: repo.name, count: activityCounts[repo.id].issues }) }] : []),
    ...(activityCounts[repo.id]?.pullRequests ? [{ id: `pulls-${repo.id}`, revision: `${activityCounts[repo.id].pullRequests}:${activityCounts[repo.id].closedPullRequests}`, repo, activity: 'pulls' as const, title: t("home.pullRequestNotice", { name: repo.name, count: activityCounts[repo.id].pullRequests }) }] : []),
  ]);
  const { unread } = useActivityNotices(notices, notificationsOpen, user?.login || '');
  const tasks = homeTaskGroups(repos, activityCounts);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const shownTasks = tasksExpanded ? tasks : tasks.slice(0, HOME_TASK_PREVIEW);
  const stackedStats = width < 360 || fontScale > 1.15;

  const load = useCallback(async (force = false) => {
    if (!client) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const active = () => request.current === controller && !controller.signal.aborted;
    setLoading(true);
    try {
      const items = await loadAllRepos(client, controller.signal);
      if (!active()) return;
      const ordered = items.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      const result = await loadOpenIssues(client, ordered, { force, signal: controller.signal });
      if (!active()) return;
      setRepos(ordered);
      setError('');
      setRepoIssueCounts(Object.fromEntries(result.groups.map((group) => [group.repo.id, group.count])));
      setActivityCounts(result.counts);
    } catch {
      if (active()) setError(t("home.couldNotLoadProjectsCheckYourConnectionAndTryAgain"));
    } finally { if (active()) setLoading(false); }
  }, [client, t]);
  useSessionReadFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));
  const { refresh, refreshing } = usePullRefresh([() => load(true)]);

  if (!ready) return <Loading />;
  if (!user) return <Page><View style={{ paddingTop: 90, gap: 18 }}><Text style={{ fontSize: 36, fontWeight: '800', color: palette.ink }}>EasyHub</Text><Text style={{ fontSize: 22, fontWeight: '700', color: palette.ink }}>{t("home.createAndShareWithEase")}</Text><Text style={{ color: palette.muted, lineHeight: 24 }}>{t("home.signInWithGitHubToViewProjectsReplyToIssuesAnd")}</Text><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></View></Page>;

  if (recovery && repos.length === 0) return <Page><Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 26, fontWeight: '800', marginBottom: 12 }}>{recovery === 'offline' ? t('sessionRecovery.offlineTitle') : t('home.myProjects')}</Text><Text style={{ color: palette.muted, lineHeight: 23 }}>{t('sessionRecovery.offlineNoProjects')}</Text></Page>;

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
    <ScrollView nestedScrollEnabled={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[palette.blue]} tintColor={palette.blue} />} contentContainerStyle={styles.content}>
      <SessionConnectionNotice />
      <View style={styles.topbar}>
        <View style={styles.brand}><Image source={appIcon} style={styles.brandIcon} /><Text style={styles.brandName} numberOfLines={1}>EasyHub</Text></View>
        <View style={styles.topbarActions}>
          <Pressable onPress={() => setNotificationsOpen(true)} accessibilityRole="button" accessibilityLabel={t("home.unreadNotifications", { count: unread })} style={styles.bellButton}><BellIcon />{unread > 0 && <View style={[styles.notificationDot, { width: 17, height: 17, borderRadius: 9, top: 0, right: -2, justifyContent: 'center', alignItems: 'center' }]}><Text style={{ color: onAccent, fontSize: 9, fontWeight: '800' }}>{unread > 99 ? '99+' : unread}</Text></View>}</Pressable>
          <Pressable onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} accessibilityRole="button" accessibilityLabel={t("home.profile")}><Image source={{ uri: user.avatar_url }} style={styles.avatar} /></Pressable>
        </View>
      </View>

      <Text accessibilityRole="header" style={styles.pageTitle}>{t("home.title")}</Text>
      <View style={styles.tasksPanel}>
        <View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.needsYourAttention")}</Text>{tasks.length > 0 && <Text accessibilityLabel={t("home.attentionTotal", { count: tasks.length })} style={styles.taskTotal}>{tasks.length}</Text>}</View>
        {shownTasks.map((group) => <HomeTaskRow key={group.repo.id} group={group} />)}
        {tasks.length > HOME_TASK_PREVIEW && <Pressable onPress={() => setTasksExpanded(!tasksExpanded)} accessibilityRole="button" accessibilityState={{ expanded: tasksExpanded }} style={styles.moreTasks}><Text style={styles.viewAll}>{tasksExpanded ? t("home.showFewerProjects") : t("home.showMoreProjects", { count: tasks.length - HOME_TASK_PREVIEW })}</Text></Pressable>}
        {!loading && !error && tasks.length === 0 && <Text style={styles.empty}>{t("home.nothingNeedsYourAttention")}</Text>}
      </View>

      <View style={styles.projectsPanel}>
        <View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.myProjects")}</Text><Pressable onPress={() => router.push('/(tabs)/projects')} accessibilityRole="button" style={styles.viewAllButton}><DirectionLabel title={t("home.viewAllProjects", { count: repos.length })} name="chevron" color={themed(themed('#2578e8'))} textStyle={styles.viewAll} /></Pressable></View>
        {!!error && <ErrorText message={error} onRetry={refresh} />}
        {repos.slice(0, 3).map((repo) => <HomeProject key={repo.id} repo={repo} issueCount={repoIssueCounts[repo.id] ?? 0} />)}
        {!loading && !error && repos.length === 0 && <Text style={styles.empty}>{t("home.noProjectsYetCreateYourFirstOne")}</Text>}
        <Pressable onPress={() => router.push('/create-project')} accessibilityRole="button" style={styles.createButton}><Text style={styles.createButtonText}>＋  {t("home.newProject")}</Text></Pressable>
      </View>

    </ScrollView>
    <Modal visible={notificationsOpen} transparent animationType="fade" onRequestClose={() => setNotificationsOpen(false)}><SafeAreaView style={styles.notificationOverlay}><View style={[styles.notificationPanel, { maxHeight: height * 0.8 }]}><View style={[styles.notificationHeader, stackedStats && styles.notificationHeaderCompact]}><Text style={[styles.notificationTitle, stackedStats && styles.notificationTitleCompact]}>{t("home.notifications")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("home.closeNotifications")} hitSlop={8} style={[styles.notificationClose, stackedStats && styles.notificationCloseCompact]} onPress={() => setNotificationsOpen(false)}><Text style={{ fontSize: 24, color: palette.muted }}>×</Text></Pressable></View>
      <ScrollView style={styles.notificationScroll} contentContainerStyle={{ paddingBottom: 4 }}>{notices.map((notice) => <Pressable key={notice.id} accessibilityRole="button" style={{ minHeight: 48 }} onPress={() => { setNotificationsOpen(false); router.push({ pathname: '/project/[owner]/[repo]', params: { owner: notice.repo.owner.login, repo: notice.repo.name, section: notice.activity } }); }}><Card><Text style={{ color: palette.ink, fontWeight: '700' }}>{notice.title}</Text><View style={{ marginTop: 6 }}><DirectionLabel title={notice.activity === 'pulls' ? t("home.codeReviews800d378a") : t("home.viewIssues")} name="forward" color={palette.blue} /></View></Card></Pressable>)}
        {!notices.length && <Text style={{ color: palette.muted, lineHeight: 22, paddingVertical: 12 }}>{t("home.noPendingNotifications")}</Text>}
      </ScrollView><Text style={{ color: palette.muted, fontSize: 12, marginTop: 8 }}>{t("home.openingMarksTheseAsReadChangedTasksWillNotifyYouAgain")}</Text>
    </View></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = themedStyles(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: themed('#f5f8fe') },
  content: { paddingHorizontal: 16, paddingBottom: 35, backgroundColor: themed('#f5f8fe') },
  topbar: { minHeight: 68, paddingVertical: 12, marginHorizontal: -16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themed('#fff'), borderBottomWidth: 1, borderBottomColor: themed('#e7edf6') },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, flexShrink: 1, minWidth: 0 },
  brandIcon: { width: 42, height: 42, borderRadius: 11 },
  brandName: { color: palette.ink, fontSize: 23, fontWeight: '800', flexShrink: 1 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 17 },
  bellButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: themed('#ef535b') },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  pageTitle: { color: themed('#18314d'), fontSize: 26, lineHeight: 34, fontWeight: '800', paddingTop: 20, paddingBottom: 14 },
  tasksPanel: { borderRadius: 20, borderWidth: 1, borderColor: themed('#e3ecf8'), padding: 11, backgroundColor: themed('#fff'), marginBottom: 14 },
  taskTotal: { minWidth: 24, paddingHorizontal: 7, borderRadius: 12, overflow: 'hidden', textAlign: 'center', color: onAccent, backgroundColor: themed('#2674e7'), fontSize: 12, lineHeight: 24, fontWeight: '800' },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, paddingLeft: 58 },
  taskSummary: { flex: 1, minWidth: 0, color: palette.muted, fontSize: 13, lineHeight: 18 },
  moreTasks: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  taskRow: { borderWidth: 1, borderColor: themed('#e2eaf5'), borderRadius: 13, padding: 10, marginTop: 8, backgroundColor: themed('#fff'), },
  openButtonPrimary: { backgroundColor: themed('#2674e7'), borderColor: themed('#2674e7') },
  openTextPrimary: { color: onAccent },
  intro: { paddingTop: 22, paddingBottom: 18 },
  eyebrow: { color: themed('#2676e8'), fontSize: 12, fontWeight: '800', marginBottom: 8 },
  greeting: { color: themed('#18314d'), fontSize: 26, lineHeight: 35, fontWeight: '800', letterSpacing: -0.5 },
  greetingCompact: { fontSize: 23, lineHeight: 32 },
  introSubtitle: { color: themed('#72839a'), fontSize: 13, lineHeight: 20, marginTop: 7 },
  createButton: { alignSelf: 'flex-start', backgroundColor: themed('#2674e7'), paddingHorizontal: 15, paddingVertical: 9, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12, shadowColor: themed('#2463c6'), shadowOpacity: 0.15, shadowRadius: 9, elevation: 2 },
  createButtonText: { color: onAccent, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  featureCard: { minHeight: 188, borderRadius: 19, backgroundColor: themed('#1b416f'), overflow: 'hidden', position: 'relative', padding: 19, marginBottom: 14, shadowColor: themed('#193f74'), shadowOpacity: 0.13, shadowRadius: 14, elevation: 3 },
  featureRing: { position: 'absolute', width: 270, height: 270, borderRadius: 135, borderWidth: 1, borderColor: '#ffffff22', right: -35, top: -45 },
  featureGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: themed('#4c8bd0'), opacity: 0.34, right: -25, bottom: -95 },
  featureCopy: { zIndex: 2, width: '100%' },
  featureCopyDecorated: { paddingRight: 145 },
  featureKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 },
  featureDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: themed('#80d5a6') },
  featureKickerText: { color: themed('#d5e9ff'), fontSize: 12, fontWeight: '800' },
  featureTitle: { color: onAccent, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  featureSubtitle: { color: themed('#d0e2f5'), fontSize: 11, lineHeight: 17, marginTop: 7 },
  featureButton: { alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: themed('#fff'), paddingHorizontal: 14, paddingVertical: 8, minHeight: 48, minWidth: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  featureButtonText: { color: themed('#1b4a7c'), fontSize: 12, fontWeight: '800', textAlign: 'center' },
  featureIcon: { position: 'absolute', width: 71, height: 71, right: 61, top: 64, transform: [{ rotate: '-11deg' }] },
  featurePlant: { position: 'absolute', width: 105, height: 105, right: -20, bottom: -12 },
  overviewCard: { borderRadius: 18, borderWidth: 1, borderColor: themed('#e2eaf5'), padding: 16, backgroundColor: themed('#fff'), marginBottom: 14 },
  overviewLabel: { color: themed('#7889a1'), fontSize: 12, fontWeight: '700', marginBottom: 10 },
  overviewStats: { flexDirection: 'row', alignItems: 'center' },
  overviewStatsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  overviewStat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  overviewStatStacked: { flex: 0, flexDirection: 'row', gap: 14, paddingVertical: 4 },
  overviewNumber: { color: themed('#173859'), fontSize: 27, fontWeight: '800', flexShrink: 0 },
  overviewNumberStacked: { minWidth: 52 },
  overviewText: { color: themed('#798aa2'), fontSize: 11, fontWeight: '700', textAlign: 'center' },
  overviewTextStacked: { flex: 1, textAlign: 'left' },
  overviewDivider: { height: 52, width: 1, backgroundColor: themed('#e9eef6'), marginHorizontal: 10 },
  overviewDividerStacked: { width: '100%', height: 1, marginHorizontal: 0, marginVertical: 8 },
  projectsPanel: { borderRadius: 20, borderWidth: 1, borderColor: themed('#e3ecf8'), padding: 11, backgroundColor: themed('#fff') },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 9 },
  sectionTitle: { color: themed('#172238'), fontSize: 19, fontWeight: '800', flexShrink: 1 },
  viewAll: { color: themed('#2578e8'), fontSize: 13 },
  viewAllButton: { minHeight: 48, minWidth: 48, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' },
  projectRow: { borderWidth: 1, borderColor: themed('#e2eaf5'), borderRadius: 13, padding: 10, marginTop: 8, minHeight: 93, backgroundColor: themed('#fff'), flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  projectBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectBodyStacked: { flex: 0, width: '100%' },
  projectActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  projectActionsStacked: { width: '100%', flexWrap: 'wrap', justifyContent: 'flex-end' },
  projectIcon: { width: 48, height: 48, borderRadius: 12, flexShrink: 0 },
  iconGlobe: { alignItems: 'center', justifyContent: 'center', backgroundColor: themed('#e9edff') },
  iconFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: themed('#e7f3ff') },
  iconLetter: { color: themed('#3988dd'), fontSize: 26, fontWeight: '800' },
  projectCopy: { flex: 1, minWidth: 0 },
  projectName: { fontSize: 15, fontWeight: '800', color: themed('#172238') },
  projectDescription: { marginTop: 3, color: themed('#7b8ba3'), fontSize: 11 },
  projectStatus: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  savedStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  savedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: themed('#18b35e'), flexShrink: 0 },
  savedText: { color: themed('#18a45a'), fontSize: 11, fontWeight: '700' },
  projectTime: { color: themed('#8797ac'), fontSize: 10, minWidth: 0, maxWidth: '100%', flexShrink: 1 },
  openButton: { paddingHorizontal: 9, paddingVertical: 8, minWidth: 46, minHeight: 44, maxWidth: '100%', borderWidth: 1, borderColor: themed('#dce6f2'), borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: themed('#f7faff') },
  openText: { color: themed('#1e2b40'), fontSize: 11, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  moreButton: { paddingHorizontal: 10, paddingVertical: 5, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 23, color: themed('#7688a0') },
  empty: { color: themed('#7b8ba3'), padding: 15 },
  notificationOverlay: { flex: 1, backgroundColor: scrim(), justifyContent: 'center', alignItems: 'center', padding: 22 },
  notificationPanel: { width: '100%', maxWidth: 500, backgroundColor: themed('#f5f8fe'), borderRadius: 19, padding: 17 },
  notificationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, flexShrink: 0, gap: 10 },
  notificationHeaderCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  notificationTitle: { color: palette.ink, fontSize: 22, fontWeight: '800', flex: 1 },
  notificationTitleCompact: { flex: 0, width: '100%', fontSize: 20 },
  notificationClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  notificationCloseCompact: { alignSelf: 'flex-end' },
  notificationScroll: { flexGrow: 0, flexShrink: 1 },
}));

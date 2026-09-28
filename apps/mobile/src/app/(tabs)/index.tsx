import { useCallback, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, ErrorText, Loading, Page, palette } from '@/components/elements';
import { loadAllRepos } from '@/features/github/data';
import { loadOpenIssues } from '@/features/github/openIssues';
import { EarthIcon } from '@/components/EarthIcon';

const appIcon = require('../../../assets/images/icon.png');
const plant = require('../../../assets/images/potted-plant.png');
const minecraftIcon = require('../../../assets/images/minecraft-grass-block.png');

function BellIcon() {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#60718b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4" />
  </Svg>;
}

function ProjectIcon({ repo }: { repo: GitHubRepo }) {
  const lower = repo.name.toLowerCase();
  if (lower.includes('minecraft')) return <Image source={minecraftIcon} style={styles.projectIcon} resizeMode="cover" />;
  if (lower === 'easyhub') return <Image source={appIcon} style={styles.projectIcon} resizeMode="cover" />;
  if (/(site|website|webpage|网站|主页)/iu.test(lower)) return <View style={[styles.projectIcon, styles.iconGlobe]}><EarthIcon size={28} color="#3159d7" /></View>;
  return <View style={[styles.projectIcon, styles.iconFallback]}><Text style={styles.iconLetter}>{repo.name.slice(0, 1).toUpperCase()}</Text></View>;
}

function relativeTime(value: string, language: 'zh' | 'en'): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return language === 'en' ? 'just now' : '刚刚';
  if (minutes < 60) return language === 'en' ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === 'en' ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return language === 'en' ? `${days} days ago` : `${days} 天前`;
}

function HomeProject({ repo, issueCount }: { repo: GitHubRepo; issueCount: number }) {
  const { language, t } = usePreferences();
  const { width } = useWindowDimensions();
  const compact = width < 350;
  const open = () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } });
  const showMore = () => Alert.alert(repo.name, undefined, [
    { text: t('打开项目', 'Open project'), onPress: open },
    { text: t('查看问题', 'View issues'), onPress: () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'issues' } }) },
    { text: t('历史版本', 'History'), onPress: () => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'history' } }) },
    { text: t('取消', 'Cancel'), style: 'cancel' },
  ]);
  return <View style={styles.projectRow}>
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${t('打开项目', 'Open project')} ${repo.name}`} style={styles.projectBody}>
      <ProjectIcon repo={repo} />
      <View style={styles.projectCopy}>
        <Text style={styles.projectName} numberOfLines={1}>{repo.name}</Text>
        <Text style={styles.projectDescription} numberOfLines={1}>{repo.description || t('这个项目还没有介绍', 'No description yet')}</Text>
        <View style={styles.projectStatus}><View style={styles.savedDot} /><Text style={styles.savedText}>{t('已保存', 'Saved')}</Text><Text style={styles.projectTime} numberOfLines={1}> · {relativeTime(repo.updated_at, language)}{compact ? '' : ` · ${issueCount} ${t('个问题', 'issues')}`}</Text></View>
      </View>
    </Pressable>
    <Pressable onPress={open} accessibilityRole="button" style={styles.openButton}><Text style={styles.openText}>{t('打开', 'Open')}</Text></Pressable>
    <Pressable onPress={showMore} accessibilityRole="button" accessibilityLabel={t('更多操作', 'More actions')} style={styles.moreButton}><Text style={styles.moreText}>⋮</Text></Pressable>
  </View>;
}

export default function Home() {
  const { ready, user, client } = useSession();
  const { language, t } = usePreferences();
  const { width } = useWindowDimensions();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [issueCount, setIssueCount] = useState(0);
  const [repoIssueCounts, setRepoIssueCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    if (!client) return;
    let active = true;
    setLoading(true);
    loadAllRepos(client).then(async (items) => {
      if (!active) return;
      const ordered = items.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      setRepos(ordered);
      setError('');
      const result = await loadOpenIssues(client, ordered);
      if (!active) return;
      setIssueCount(result.groups.reduce((total, group) => total + group.count, 0));
      setRepoIssueCounts(Object.fromEntries(result.groups.map((group) => [group.repo.id, group.count])));
    }).catch(() => {
      if (active) setError(t('项目加载失败，请检查网络后重试。', 'Could not load projects. Check your connection and try again.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, t]);
  useFocusEffect(refresh);

  if (!ready) return <Loading />;
  if (!user) return <Page><View style={{ paddingTop: 90, gap: 18 }}><Text style={{ fontSize: 36, fontWeight: '800', color: palette.ink }}>EasyHub</Text><Text style={{ fontSize: 22, fontWeight: '700', color: palette.ink }}>{t('让创作和分享更简单。', 'Create and share with ease.')}</Text><Text style={{ color: palette.muted, lineHeight: 24 }}>{t('使用 GitHub 登录，在手机上查看项目、回复问题、下载历史版本。', 'Sign in with GitHub to view projects, reply to issues and download past versions.')}</Text><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></View></Page>;

  const hour = new Date().getHours();
  const greeting = hour < 11 ? t('早上好', 'Good morning') : hour < 18 ? t('下午好', 'Good afternoon') : t('晚上好', 'Good evening');

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <View style={styles.brand}><Image source={appIcon} style={styles.brandIcon} /><Text style={styles.brandName}>EasyHub</Text></View>
        <View style={styles.topbarActions}>
          <Pressable onPress={() => router.push('/(tabs)/issues')} accessibilityRole="button" accessibilityLabel={t('查看问题', 'View issues')} style={styles.bellButton}><BellIcon />{issueCount > 0 && <View style={styles.notificationDot} />}</Pressable>
          <Pressable onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} accessibilityRole="button" accessibilityLabel={t('个人主页', 'Profile')}><Image source={{ uri: user.avatar_url }} style={styles.avatar} /></Pressable>
        </View>
      </View>

      <View style={styles.intro}>
        <Text style={styles.eyebrow}>{t('你的创作空间', 'Your creative space')}</Text>
        <Text style={[styles.greeting, width < 375 && styles.greetingCompact]}>{greeting}，{t('今天也来做点有趣的事情。', 'let’s make something fun today.')}</Text>
        <Text style={styles.introSubtitle}>{t('项目已经妥善保存。接下来想做什么，由你决定。', 'Your projects are safely saved. What happens next is up to you.')}</Text>
        <Pressable onPress={() => router.push('/create-project')} accessibilityRole="button" style={styles.createButton}><Text style={styles.createButtonText}>＋  {t('新建项目', 'New project')}</Text></Pressable>
      </View>

      <View style={styles.featureCard}>
        <View style={styles.featureRing} /><View style={styles.featureGlow} />
        <View style={styles.featureCopy}>
          <View style={styles.featureKicker}><View style={styles.featureDot} /><Text style={styles.featureKickerText}>{t('接着创作', 'Keep creating')}</Text></View>
          <Text style={styles.featureTitle}>{t('你的项目已经全部保存。', 'Your projects are all saved.')}</Text>
          <Text style={styles.featureSubtitle}>{t('有新想法时，打开项目继续创作。', 'When inspiration strikes, open a project and keep creating.')}</Text>
          <Pressable onPress={() => router.push('/(tabs)/projects')} accessibilityRole="button" style={styles.featureButton}><Text style={styles.featureButtonText}>{t('查看项目', 'View projects')}  →</Text></Pressable>
        </View>
        <Image source={appIcon} style={styles.featureIcon} />
        <Image source={plant} resizeMode="contain" style={styles.featurePlant} />
      </View>

      <View style={styles.overviewCard}>
        <Text style={styles.overviewLabel}>{t('一眼看清进展', 'Your progress at a glance')}</Text>
        <View style={styles.overviewStats}>
          <View style={styles.overviewStat}><Text style={styles.overviewNumber}>{String(repos.length).padStart(2, '0')}</Text><Text style={styles.overviewText}>{t('我的项目', 'Projects')}</Text></View>
          <View style={styles.overviewDivider} />
          <View style={styles.overviewStat}><Text style={styles.overviewNumber}>{String(issueCount).padStart(2, '0')}</Text><Text style={styles.overviewText}>{t('待处理问题', 'Open issues')}</Text></View>
        </View>
      </View>

      <View style={styles.projectsPanel}>
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{t('我的项目', 'My projects')}</Text><Pressable onPress={() => router.push('/(tabs)/projects')} accessibilityRole="button"><Text style={styles.viewAll}>{t('查看全部', 'View all')}  ›</Text></Pressable></View>
        {!!error && <ErrorText message={error} onRetry={refresh} />}
        {repos.slice(0, 3).map((repo) => <HomeProject key={repo.id} repo={repo} issueCount={repoIssueCounts[repo.id] ?? 0} />)}
        {!loading && !error && repos.length === 0 && <Text style={styles.empty}>{t('还没有项目，创建第一个吧。', 'No projects yet. Create your first one.')}</Text>}
      </View>

      {repos.length > 0 && <View style={styles.recentPanel}>
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{t('最近更新', 'Recent updates')}</Text><Pressable onPress={() => router.push('/(tabs)/projects')} accessibilityRole="button"><Text style={styles.viewAll}>{t('查看全部', 'View all')}  ›</Text></Pressable></View>
        {repos.slice(0, 4).map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'history' } })} accessibilityRole="button" style={styles.recentRow}>
          <ProjectIcon repo={repo} />
          <View style={styles.recentCopy}><Text style={styles.recentName} numberOfLines={1}>{repo.name}</Text><Text style={styles.recentDescription} numberOfLines={1}>{repo.description || t('查看项目最新内容', 'View the latest project content')}</Text></View>
          <Text style={styles.recentTime}>{relativeTime(repo.updated_at, language)}</Text>
        </Pressable>)}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f8fe' },
  content: { paddingHorizontal: 16, paddingBottom: 35, backgroundColor: '#f5f8fe' },
  topbar: { height: 68, marginHorizontal: -16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e7edf6' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandIcon: { width: 42, height: 42, borderRadius: 11 },
  brandName: { color: palette.ink, fontSize: 23, fontWeight: '800' },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 17 },
  bellButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef535b' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  intro: { paddingTop: 22, paddingBottom: 18 },
  eyebrow: { color: '#2676e8', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  greeting: { color: '#18314d', fontSize: 26, lineHeight: 35, fontWeight: '800', letterSpacing: -0.5 },
  greetingCompact: { fontSize: 23, lineHeight: 32 },
  introSubtitle: { color: '#72839a', fontSize: 13, lineHeight: 20, marginTop: 7 },
  createButton: { alignSelf: 'flex-start', backgroundColor: '#2674e7', paddingHorizontal: 15, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 15, shadowColor: '#2463c6', shadowOpacity: 0.15, shadowRadius: 9, elevation: 2 },
  createButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  featureCard: { minHeight: 188, borderRadius: 19, backgroundColor: '#1b416f', overflow: 'hidden', position: 'relative', padding: 19, marginBottom: 14, shadowColor: '#193f74', shadowOpacity: 0.13, shadowRadius: 14, elevation: 3 },
  featureRing: { position: 'absolute', width: 270, height: 270, borderRadius: 135, borderWidth: 1, borderColor: '#ffffff22', right: -35, top: -45 },
  featureGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#4c8bd0', opacity: 0.34, right: -25, bottom: -95 },
  featureCopy: { zIndex: 2, width: '71%' },
  featureKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 },
  featureDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#80d5a6' },
  featureKickerText: { color: '#d5e9ff', fontSize: 12, fontWeight: '800' },
  featureTitle: { color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  featureSubtitle: { color: '#d0e2f5', fontSize: 11, lineHeight: 17, marginTop: 7 },
  featureButton: { alignSelf: 'flex-start', backgroundColor: '#fff', paddingHorizontal: 14, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  featureButtonText: { color: '#1b4a7c', fontSize: 12, fontWeight: '800' },
  featureIcon: { position: 'absolute', width: 71, height: 71, right: 61, top: 64, transform: [{ rotate: '-11deg' }] },
  featurePlant: { position: 'absolute', width: 105, height: 105, right: -20, bottom: -12 },
  overviewCard: { borderRadius: 18, borderWidth: 1, borderColor: '#e2eaf5', padding: 16, backgroundColor: '#fff', marginBottom: 14 },
  overviewLabel: { color: '#7889a1', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  overviewStats: { flexDirection: 'row', alignItems: 'center' },
  overviewStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  overviewNumber: { color: '#173859', fontSize: 27, fontWeight: '800' },
  overviewText: { color: '#798aa2', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  overviewDivider: { height: 31, width: 1, backgroundColor: '#e9eef6', marginHorizontal: 10 },
  projectsPanel: { borderRadius: 20, borderWidth: 1, borderColor: '#e3ecf8', padding: 11, backgroundColor: '#fff' },
  recentPanel: { borderRadius: 20, borderWidth: 1, borderColor: '#e3ecf8', padding: 11, backgroundColor: '#fff', marginTop: 14 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 9 },
  sectionTitle: { color: '#172238', fontSize: 19, fontWeight: '800' },
  viewAll: { color: '#2578e8', fontSize: 13 },
  projectRow: { borderWidth: 1, borderColor: '#e2eaf5', borderRadius: 13, padding: 10, marginTop: 8, minHeight: 93, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectIcon: { width: 48, height: 48, borderRadius: 12 },
  iconGlobe: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#e9edff' },
  iconFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7f3ff' },
  iconLetter: { color: '#3988dd', fontSize: 26, fontWeight: '800' },
  projectCopy: { flex: 1, minWidth: 0 },
  projectName: { fontSize: 15, fontWeight: '800', color: '#172238' },
  projectDescription: { marginTop: 3, color: '#7b8ba3', fontSize: 11 },
  projectStatus: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  savedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#18b35e' },
  savedText: { color: '#18a45a', fontSize: 11, fontWeight: '700' },
  projectTime: { color: '#8797ac', fontSize: 10, flexShrink: 1 },
  openButton: { paddingHorizontal: 9, minWidth: 46, height: 31, borderWidth: 1, borderColor: '#dce6f2', borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f7faff' },
  openText: { color: '#1e2b40', fontSize: 11, fontWeight: '700' },
  moreButton: { width: 20, height: 34, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 23, color: '#7688a0' },
  empty: { color: '#7b8ba3', padding: 15 },
  recentRow: { minHeight: 68, paddingVertical: 9, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#edf2f8', flexDirection: 'row', alignItems: 'center', gap: 10 },
  recentCopy: { flex: 1, minWidth: 0 },
  recentName: { color: '#172238', fontSize: 14, fontWeight: '800' },
  recentDescription: { color: '#8290a3', fontSize: 11, marginTop: 3 },
  recentTime: { color: '#8290a3', fontSize: 11, maxWidth: 65, textAlign: 'right' },
});

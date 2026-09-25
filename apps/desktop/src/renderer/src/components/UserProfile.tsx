import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Folder, MapPin, Users } from 'lucide-react';
import type { Contributions, GitHubUser } from '@easyhub/github';

const api = <T,>(action: string, ...args: unknown[]): Promise<T> => window.easyHub ? window.easyHub.github<T>(action, ...args) : Promise.reject(new Error('应用连接不可用，请重新启动 EasyHub。'));
const bounds = (year: number): [string, string] => [`${year}-01-01T00:00:00.000Z`, `${year}-12-31T23:59:59.999Z`];

export function UserProfile({ login, initialUser, onBack, onOpenRepository }: { login: string; initialUser: GitHubUser; onBack: () => void; onOpenRepository: (fullName: string) => void }) {
  const [profile, setProfile] = useState(initialUser);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [data, setData] = useState<Contributions | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [dayData, setDayData] = useState<Contributions | null>(null);
  const [busy, setBusy] = useState(true);
  const [dayBusy, setDayBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api<GitHubUser>('profile', login).then((item) => { if (active) setProfile(item); }).catch(() => undefined);
    return () => { active = false; };
  }, [login]);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setData(null); setDay(null); setDayData(null);
    void api<Contributions>('contributions', login, ...bounds(year)).then((result) => { if (active) setData(result); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '贡献数据暂时不可用。'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [login, year]);
  useEffect(() => {
    if (!day) return;
    let active = true;
    setDayBusy(true); setDayData(null);
    void api<Contributions>('contributions', login, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`).then((result) => { if (active) setDayData(result); }).catch(() => { if (active) setDayData(null); }).finally(() => { if (active) setDayBusy(false); });
    return () => { active = false; };
  }, [login, day]);
  const years = Array.from(new Set([new Date().getUTCFullYear(), ...(data?.years ?? []), year])).sort((a, b) => b - a);
  const entries = (day ? dayData : data)?.repositories.filter((item) => item.count > 0).sort((a, b) => b.count - a.count) ?? [];
  const avatar = profile.avatar_url || initialUser.avatar_url;
  return <div className="profile-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回</button>
    <section className="panel profile-hero">{avatar ? <img className="profile-avatar" src={avatar} alt={`${login} 的头像`} /> : <span className="profile-avatar profile-avatar-fallback" aria-label={`${login} 的头像`}>{login.slice(0, 1).toUpperCase()}</span>}<div><div className="eyebrow">GitHub 个人页面</div><h1>{profile.name || login}</h1><p className="profile-handle">@{login}</p><p>{profile.bio || '还没有个人简介。'}</p><div className="profile-meta"><span><Users size={16} />{profile.followers ?? '—'} 位关注者 · 正在关注 {profile.following ?? '—'} 人</span><span><Folder size={16} />{profile.public_repos ?? '—'} 个公开项目</span>{profile.location && <span><MapPin size={16} />{profile.location}</span>}</div></div></section>
    <section className="panel contribution-panel"><div className="panel-heading"><div><h2>{year} 年贡献表</h2><p>点击方格，查看当天参与的项目和互动。</p></div><span className="contribution-total">{busy ? '加载中…' : `${data?.total ?? 0} 次贡献`}</span></div>
      <div className="contribution-years" role="group" aria-label="选择年份">{years.map((item) => <button key={item} className={item === year ? 'selected' : ''} onClick={() => setYear(item)}>{item}</button>)}</div>
      {error ? <p className="live-error" role="alert">{error}</p> : <div className="contribution-calendar" role="grid" aria-label={`${year} 年贡献表`}>{data?.weeks.map((week, index) => <div className="contribution-week" key={index}>{week.contributionDays.map((item) => <button key={item.date} type="button" className={`contribution-cell ${day === item.date ? 'selected' : ''}`} style={{ backgroundColor: item.contributionCount ? item.color : undefined }} aria-label={`${item.date}：${item.contributionCount} 次贡献`} title={`${item.date} · ${item.contributionCount} 次贡献`} onClick={() => setDay(item.date)} />)}</div>)}</div>}
      <div className="contribution-legend">较少 <i /><i /><i /><i /><i /> 较多</div>
    </section>
    <section className="panel profile-repositories"><div className="panel-heading"><div><h2>{day ? `${day} 的项目与社交活动` : `${year} 年参与的项目`}</h2><p>{day ? '包括公开和可访问的项目中的更新、问题与合并请求。' : '选择贡献表中的日期，可按天查看。'}</p></div>{day && <button className="text-link" onClick={() => { setDay(null); setDayData(null); }}>查看全年 <ArrowRight size={15} /></button>}</div>
      {dayBusy ? <p className="live-empty"><Clock3 size={16} /> 正在加载当天数据…</p> : entries.length ? entries.map((item) => <button className="profile-repo-row" key={`${item.fullName}:${item.kind}`} disabled={item.isPrivate} onClick={() => onOpenRepository(item.fullName)}><span className="profile-repo-icon"><Folder size={18} /></span><span><strong>{item.isPrivate ? '私有项目' : item.fullName}</strong><small>{item.kind} · {item.count} 次{item.isPrivate ? ' · 不可公开浏览' : ''}</small></span><ArrowRight size={17} /></button>) : <p className="live-empty">{busy ? '正在加载贡献记录…' : '这段时间没有可展示的项目活动。'}</p>}
    </section>
  </div>;
}

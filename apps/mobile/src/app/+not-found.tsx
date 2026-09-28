import { Link } from 'expo-router';
import { Heading, Page, palette } from '@/components/elements';

export default function NotFound() {
  return <Page><Heading title="找不到这个页面" subtitle="它可能已经被移走。" /><Link href="/" style={{ color: palette.blue }}>返回首页</Link></Page>;
}

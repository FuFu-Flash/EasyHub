export function SearchPagination({ page, totalCount, hasNextPage, busy, onPageChange }: {
  page: number; totalCount: number | null; hasNextPage: boolean; busy: boolean; onPageChange: (page: number) => void;
}) {
  return <div className="search-pagination">
    {totalCount !== null && <p className="muted" role="status">{`找到 ${totalCount.toLocaleString()} 项结果`}{totalCount > 1000 && <span> · 结果较多，请细化搜索条件以查找更多内容。</span>}</p>}
    {(page > 1 || hasNextPage) && <nav className="trending-pagination" aria-label="搜索结果翻页">
      <button className="button button-quiet" disabled={page <= 1 || busy} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span>{`第 ${page} 页`}</span>
      <button className="button button-quiet" disabled={!hasNextPage || busy} onClick={() => onPageChange(page + 1)}>下一页</button>
    </nav>}
  </div>;
}

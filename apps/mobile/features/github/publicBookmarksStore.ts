import { File, Paths } from 'expo-file-system';
import { parsePublicBookmarks, type PublicBookmark } from './publicBookmarks';

function bookmarksFile(login: string): File {
  return new File(Paths.document, `easyhub-public-bookmarks-${login.toLowerCase()}.json`);
}

export async function loadPublicBookmarks(login: string): Promise<PublicBookmark[]> {
  const file = bookmarksFile(login);
  return file.exists ? parsePublicBookmarks(await file.text()) : [];
}

export function savePublicBookmarks(login: string, bookmarks: PublicBookmark[]): void {
  const file = bookmarksFile(login);
  if (!file.exists) file.create();
  file.write(JSON.stringify(bookmarks));
}

import { useSyncExternalStore } from "react";
import { File, Paths } from "expo-file-system";
import { createProgramReviewNoticeStore } from "./programReviewNotice";

const store = createProgramReviewNoticeStore({
  read: () => {
    const file = new File(Paths.document, "easyhub-program-review-prompts.txt");
    return file.exists ? file.textSync() : null;
  },
  write: (value) => {
    const file = new File(Paths.document, "easyhub-program-review-prompts.txt");
    if (!file.exists) file.create();
    file.write(value);
  },
});

export function useProgramReviewNotice() {
  const noticesEnabled = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return { noticesEnabled, setNoticesEnabled: store.set };
}
